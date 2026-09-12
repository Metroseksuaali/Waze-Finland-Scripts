// ==UserScript==
// @name         WME Kelikamerat (Digitraffic)
// @namespace    https://github.com/samisepp/Waze-Finland-Scripts
// @version      0.10.1
// @description  Näyttää Fintrafficin liikenne-/kelikamerat WME:ssä. Kuva avautuu klikkaamalla, mukana 24 tunnin kelaus ja automaattinen päivitys.
// @author       samisepp
// @match        https://*.waze.com/*editor*
// @exclude      https://*.waze.com/user/editor*
// @exclude      https://*.waze.com/editor/sdk/*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/Metroseksuaali/Waze-Finland-Scripts/main/scripts/digitraffic-kelikamerat/WME-digitraffic-kelikamerat.user.js
// @downloadURL  https://raw.githubusercontent.com/Metroseksuaali/Waze-Finland-Scripts/main/scripts/digitraffic-kelikamerat/WME-digitraffic-kelikamerat.user.js
// @connect      tie.digitraffic.fi
// @connect      weathercam.digitraffic.fi
// @run-at       document-idle
// ==/UserScript==

/* Data: Fintraffic / Digitraffic, lisenssi CC BY 4.0 */

(function () {
    'use strict';

    const SCRIPT_ID = 'wme-kelikamerat';
    const SCRIPT_NAME = 'WME Kelikamerat';
    const VERSION = '0.10.1';
    const LAYER_NAME = 'wme_kelikamerat';
    const CHECKBOX_NAME = 'Kelikamerat';
    const DT_USER = 'samisepp/WME-Kelikamerat ' + VERSION;
    const API = 'https://tie.digitraffic.fi/api/weathercam/v1/stations';
    const IMG_BASE = 'https://weathercam.digitraffic.fi/';
    const FT_BASE = 'https://liikennetilanne.fintraffic.fi/kelikamerat/';

    const SKEEMA = 'v5';
    const CACHE_KEY = `wmeKelikamerat_${SKEEMA}_asemat`;
    const CACHE_KEY_DETAIL = `wmeKelikamerat_${SKEEMA}_asema_`;
    const UI_KEY = 'wmeKelikamerat_ui';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    const MIN_ZOOM = 12;
    const MAX_MARKERS = 400;
    const MIN_W = 320;
    const REUNA = 10;
    const PAIVITYSVALI_MS = 2 * 60 * 1000;   // kuvat vaihtuvat n. 10 min välein
    const TOISTO_MS = 200;                   // 5 kuvaa/s: 24 h noin 30 sekunnissa
    const ESILATAUS = 6;                     // montako kehystä haetaan etukäteen
    const KEHYS_MAX = 80;                    // muistissa pidettävät kehykset
    const HISTORIA_TTL_MS = 5 * 60 * 1000;   // historialistan tuoreus muistissa

    // Tilat, joissa kamera ei käytännössä tuota kuvaa.
    const VIKATILAT = new Set([
        'FAULT_CONFIRMED',
        'FAULT_CONFIRMED_NOT_FIXED_IN_NEAR_FUTURE',
        'REPAIR_REQUEST_POSTED',
        'REPAIR_INTERRUPTED'
    ]);

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const loki = (...a) => console.log('[Kelikamerat]', ...a);

    const kameraIkoni = (vari, reuna) => 'data:image/svg+xml;base64,' + btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">' +
        `<circle cx="13" cy="13" r="11" fill="${vari}" stroke="${reuna}" stroke-width="2"/>` +
        '<rect x="6" y="10" width="9" height="7" rx="1.5" fill="#ffffff"/>' +
        '<path d="M15 12.5 L19.5 9.5 L19.5 17.5 L15 14.5 Z" fill="#ffffff"/>' +
        '</svg>'
    );
    const ICON_OK = kameraIkoni('#0b6ec9', '#ffffff');
    const ICON_VIKA = kameraIkoni('#8e979f', '#e2e5e8');

    let sdk = null;
    let asemat = [];
    let layerVisible = true;
    let avoinAsema = null;
    const detailCache = new Map();
    const historiaCache = new Map();   // asemaId -> { ts, presets: { presetId: [{aika, url}] } }

    const ui = Object.assign({ leveys: null, left: null, top: null }, lueUi());

    win.SDK_INITIALIZED.then(init).catch(err => console.error(SCRIPT_NAME, err));

    async function init() {
        sdk = win.getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME });
        if (!sdk.State.isReady()) {
            await sdk.Events.once({ eventName: 'wme-ready' });
        }

        siivoaVanhat();
        lisaaTyylit();

        const ikoniTyyli = (ikoni, lapinakyvyys) => ({
            externalGraphic: ikoni,
            graphicWidth: 26,
            graphicHeight: 26,
            graphicXOffset: -13,
            graphicYOffset: -13,
            graphicOpacity: lapinakyvyys,
            cursor: 'pointer'
        });

        sdk.Map.addLayer({
            layerName: LAYER_NAME,
            // Säännöt ovat toisensa poissulkevia: ehdoton oletussääntö
            // ylikirjoittaisi tarkemman säännön.
            styleRules: [
                {
                    predicate: (p) => !!p && p.vika === true,
                    style: ikoniTyyli(ICON_VIKA, 0.7)
                },
                {
                    predicate: (p) => !p || p.vika !== true,
                    style: ikoniTyyli(ICON_OK, 0.95)
                }
            ],
            zIndexing: true
        });
        sdk.Map.setLayerVisibility({ layerName: LAYER_NAME, visibility: true });

        sdk.LayerSwitcher.addLayerCheckbox({ name: CHECKBOX_NAME, isChecked: true });
        sdk.Events.on({
            eventName: 'wme-layer-checkbox-toggled',
            eventHandler: ({ name, checked }) => {
                if (name !== CHECKBOX_NAME) return;
                layerVisible = checked;
                sdk.Map.setLayerVisibility({ layerName: LAYER_NAME, visibility: checked });
                if (checked) piirra(); else suljePaneeli();
            }
        });

        sdk.Events.trackLayerEvents({ layerName: LAYER_NAME });
        sdk.Events.on({ eventName: 'wme-layer-feature-clicked', eventHandler: onKlikkaus });
        sdk.Events.on({ eventName: 'wme-map-move-end', eventHandler: () => { piirra(); sijoitaPaneeli(); } });

        window.addEventListener('resize', () => { asetaLeveys(nykyinenLeveys()); sijoitaPaneeli(); });

        win.WMEKelikamerat = {
            asemat: () => asemat,
            tyhjennaKaikki
        };

        try {
            asemat = await haeAsemat();
            const vikoja = asemat.filter(a => a.vika).length;
            loki(`${asemat.length} kamera-asemaa ladattu (${vikoja} vikatilassa).`);
            piirra();
        } catch (err) {
            console.error(`${SCRIPT_NAME}: asemien lataus epäonnistui`, err);
        }
    }

    // ---------- Verkko ja välimuisti ----------

    function gmGet(url, asetukset) {
        const o = asetukset || {};
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: o.responseType || 'text',
                headers: Object.assign({ 'Digitraffic-User': DT_USER }, o.headers || {}),
                onload: r => {
                    const ok = (r.status >= 200 && r.status < 300)
                        || (o.salli304 && r.status === 304);
                    if (ok) resolve(r);
                    else reject(new Error('HTTP ' + r.status + ' – ' + String(r.responseText).slice(0, 200)));
                },
                onerror: () => reject(new Error('Verkkovirhe: ' + url)),
                ontimeout: () => reject(new Error('Aikakatkaisu: ' + url))
            });
        });
    }

    function otsake(vastaus, nimi) {
        const raaka = vastaus && vastaus.responseHeaders;
        if (!raaka) return null;
        const rivi = raaka.split(/\r?\n/).find(r => r.toLowerCase().startsWith(nimi.toLowerCase() + ':'));
        return rivi ? rivi.slice(rivi.indexOf(':') + 1).trim() : null;
    }

    function lueVälimuisti(key) {
        try {
            const c = JSON.parse(localStorage.getItem(key) || 'null');
            if (c && (Date.now() - c.ts) < CACHE_TTL_MS) return c.data;
        } catch (e) { /* viallinen välimuisti ohitetaan */ }
        return null;
    }

    function kirjoitaVälimuisti(key, data) {
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); }
        catch (e) { /* localStorage täynnä – ei kriittistä */ }
    }

    function siivoaVanhat() {
        const uusiEtuliite = `wmeKelikamerat_${SKEEMA}_`;
        let n = 0;
        for (const avain of Object.keys(localStorage)) {
            if (!avain.startsWith('wmeKelikamerat_')) continue;
            if (avain === UI_KEY || avain.startsWith(uusiEtuliite)) continue;
            localStorage.removeItem(avain);
            n++;
        }
        if (n) loki(`Poistettiin ${n} vanhentunutta välimuistiavainta.`);
    }

    function tyhjennaKaikki() {
        detailCache.clear();
        historiaCache.clear();
        for (const avain of Object.keys(localStorage)) {
            if (avain.startsWith('wmeKelikamerat_') && avain !== UI_KEY) {
                localStorage.removeItem(avain);
            }
        }
        loki('Välimuisti tyhjennetty. Lataa WME uudelleen.');
    }

    function lueUi() {
        try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; }
        catch (e) { return {}; }
    }

    function tallennaUi() {
        try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); }
        catch (e) { /* ei kriittistä */ }
    }

    async function haeAsemat() {
        const cached = lueVälimuisti(CACHE_KEY);
        if (Array.isArray(cached)) return cached;

        const r = await gmGet(API);
        const json = JSON.parse(r.responseText);
        const data = (json.features || []).map(f => {
            const p = f.properties || {};
            const c = (f.geometry && f.geometry.coordinates) || [];
            if (typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
            if (p.collectionStatus === 'REMOVED_PERMANENTLY') return null;
            const presetteja = (p.presets || []).filter(pr => pr.inCollection !== false).length;
            if (!presetteja) return null;
            const vika = VIKATILAT.has(p.state) || p.collectionStatus === 'REMOVED_TEMPORARILY';
            return {
                id: f.id || p.id,
                nimi: p.name || p.id || '',
                lon: c[0],
                lat: c[1],
                vika,
                tila: p.state || '',
                keruu: p.collectionStatus || ''
            };
        }).filter(Boolean);

        kirjoitaVälimuisti(CACHE_KEY, data);
        return data;
    }

    // Esiasentojen selkokieliset nimet löytyvät vain asemakohtaisesta vastauksesta.
    async function haeAsemanTiedot(id) {
        if (detailCache.has(id)) return detailCache.get(id);

        const cached = lueVälimuisti(CACHE_KEY_DETAIL + id);
        if (cached) { detailCache.set(id, cached); return cached; }

        const r = await gmGet(`${API}/${encodeURIComponent(id)}`);
        const json = JSON.parse(r.responseText);
        const p = json.properties || {};
        const ra = p.roadAddress || null;
        const virallinen = (p.names && p.names.fi) || '';
        if (!virallinen) {
            console.warn(`${SCRIPT_NAME}: asemalta ${id} puuttuu names.fi`, p.names);
        }
        // Tieosoite kootaan muotoon 1/33/4520, jotta se ei muistuta nimeä.
        const osoiteOsat = ra
            ? [ra.roadNumber, ra.roadSection, ra.distanceFromRoadSectionStart]
                .filter(v => v !== null && v !== undefined)
            : [];
        const tiedot = {
            id: json.id || p.id || id,
            nimi: virallinen || p.name || id,
            tekninen: p.name || '',
            kunta: p.municipality || '',
            tieosoite: osoiteOsat.length ? 'Tieosoite ' + osoiteOsat.join('/') : '',
            presets: (p.presets || [])
                .filter(pr => pr.inCollection !== false)
                .map(pr => ({
                    id: pr.id,
                    nimi: pr.presentationName || pr.id,
                    resoluutio: pr.resolution || '',
                    imageUrl: pr.imageUrl || (IMG_BASE + pr.id + '.jpg')
                }))
        };

        detailCache.set(id, tiedot);
        kirjoitaVälimuisti(CACHE_KEY_DETAIL + id, tiedot);
        return tiedot;
    }

    // Yhdellä kutsulla saadaan kaikkien esiasentojen 24 tunnin kuvahistoria.
    async function haeHistoria(asemaId) {
        const muistissa = historiaCache.get(asemaId);
        if (muistissa && (Date.now() - muistissa.ts) < HISTORIA_TTL_MS) return muistissa.presets;

        const r = await gmGet(`${API}/${encodeURIComponent(asemaId)}/history`);
        const json = JSON.parse(r.responseText);
        const presets = {};
        for (const p of (json.presets || [])) {
            const rivit = (p.history || [])
                .filter(h => h && h.imageUrl && h.lastModified)
                .map(h => ({ aika: Date.parse(h.lastModified), url: h.imageUrl }))
                .filter(h => Number.isFinite(h.aika))
                .sort((a, b) => a.aika - b.aika);
            if (rivit.length) presets[p.id] = rivit;
        }
        historiaCache.set(asemaId, { ts: Date.now(), presets });
        return presets;
    }

    // ---------- Piirto ----------

    function piirra() {
        if (!sdk || !layerVisible) return;
        sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_NAME });
        if (sdk.Map.getZoomLevel() < MIN_ZOOM || !asemat.length) return;

        const [minLon, minLat, maxLon, maxLat] = sdk.Map.getMapExtent();
        const features = [];
        for (const a of asemat) {
            if (a.lon < minLon || a.lon > maxLon || a.lat < minLat || a.lat > maxLat) continue;
            features.push({
                id: a.id,
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
                properties: { nimi: a.nimi, vika: !!a.vika }
            });
            if (features.length >= MAX_MARKERS) break;
        }
        if (features.length) {
            sdk.Map.addFeaturesToLayer({ layerName: LAYER_NAME, features });
        }
    }

    // ---------- Koko ----------

    function oletusLeveys() {
        return Math.round(Math.min(760, Math.max(380, window.innerWidth * 0.34)));
    }

    function maxLeveys() {
        return Math.max(MIN_W, Math.min(1200, window.innerWidth - 2 * REUNA));
    }

    function nykyinenLeveys() {
        return ui.leveys || oletusLeveys();
    }

    function asetaLeveys(px, tallenna) {
        const w = Math.round(Math.min(Math.max(px, MIN_W), maxLeveys()));
        ui.leveys = w;
        const panel = document.getElementById('wme-kelikamerat-panel');
        if (panel) panel.style.width = w + 'px';
        if (tallenna) tallennaUi();
        return w;
    }

    // ---------- Sijainti ----------

    function karttaPikselit(lon, lat) {
        try {
            const el = sdk.Map.getMapViewportElement();
            const rect = el.getBoundingClientRect();
            const px = sdk.Map.getMapPixelFromLonLat({ lonLat: { lon, lat } });
            if (px && typeof px.x === 'number' && typeof px.y === 'number') {
                return { x: rect.left + px.x, y: rect.top + px.y };
            }
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        } catch (e) {
            return null;
        }
    }

    function rajaa(panel, left, top) {
        const w = panel.offsetWidth || nykyinenLeveys();
        const h = panel.offsetHeight || 360;
        return {
            left: Math.min(Math.max(left, REUNA), Math.max(REUNA, window.innerWidth - w - REUNA)),
            top: Math.min(Math.max(top, REUNA), Math.max(REUNA, window.innerHeight - h - REUNA))
        };
    }

    function sijoitaPaneeli() {
        const panel = document.getElementById('wme-kelikamerat-panel');
        if (!panel) return;

        if (ui.left !== null && ui.top !== null) {
            const r = rajaa(panel, ui.left, ui.top);
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            return;
        }
        if (!avoinAsema) return;

        const p = karttaPikselit(avoinAsema.lon, avoinAsema.lat);
        const w = panel.offsetWidth || nykyinenLeveys();
        const h = panel.offsetHeight || 360;

        if (!p) {
            const r = rajaa(panel, (window.innerWidth - w) / 2, (window.innerHeight - h) / 2);
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            return;
        }

        let left = p.x + 24;
        if (left + w + REUNA > window.innerWidth) left = p.x - w - 24;
        const r = rajaa(panel, left, p.y - h / 2);
        panel.style.left = r.left + 'px';
        panel.style.top = r.top + 'px';
    }

    // ---------- Kuvan lataus ----------

    // Kuvat haetaan GM_xmlhttpRequestilla, jotta ETag on käytettävissä
    // ehdollisiin pyyntöihin eikä WME:n CSP pääse estämään latausta.
    const kuvaTila = { url: null, etag: null, objectUrl: null };

    function vapautaObjectUrl() {
        if (kuvaTila.objectUrl) {
            URL.revokeObjectURL(kuvaTila.objectUrl);
            kuvaTila.objectUrl = null;
        }
    }

    async function asetaKuva(img, url) {
        kuvaTila.url = url;
        kuvaTila.etag = null;
        try {
            const r = await gmGet(url, { responseType: 'blob' });
            if (kuvaTila.url !== url) return; // käyttäjä ehti vaihtaa kuvaa
            vapautaObjectUrl();
            kuvaTila.objectUrl = URL.createObjectURL(r.response);
            kuvaTila.etag = otsake(r, 'etag');
            img.src = kuvaTila.objectUrl;
            img.alt = '';
        } catch (err) {
            console.warn(`${SCRIPT_NAME}: kuvan lataus epäonnistui`, err);
            img.src = url; // viimeinen yritys suoraan
            img.alt = 'Kuvan lataus epäonnistui – käytä alla olevaa linkkiä.';
        }
    }

    // Toiston kehykset pidetään erillään live-kuvasta, jotta selailu on sujuvaa.
    const kehysCache = new Map(); // url -> object-URL

    async function haeKehys(url) {
        if (kehysCache.has(url)) return kehysCache.get(url);
        const r = await gmGet(url, { responseType: 'blob' });
        const o = URL.createObjectURL(r.response);
        kehysCache.set(url, o);
        if (kehysCache.size > KEHYS_MAX) {
            const vanhin = kehysCache.keys().next().value;
            URL.revokeObjectURL(kehysCache.get(vanhin));
            kehysCache.delete(vanhin);
        }
        return o;
    }

    function tyhjennaKehykset() {
        for (const o of kehysCache.values()) URL.revokeObjectURL(o);
        kehysCache.clear();
    }

    const odota = ms => new Promise(r => setTimeout(r, ms));

    async function paivitaKuva(img) {
        if (!kuvaTila.url) return false;
        const url = kuvaTila.url;
        const headers = kuvaTila.etag ? { 'If-None-Match': kuvaTila.etag } : {};
        try {
            const r = await gmGet(url, { responseType: 'blob', headers, salli304: true });
            if (r.status === 304) return false;          // kuva ei ole muuttunut
            if (kuvaTila.url !== url) return false;
            vapautaObjectUrl();
            kuvaTila.objectUrl = URL.createObjectURL(r.response);
            kuvaTila.etag = otsake(r, 'etag') || kuvaTila.etag;
            img.src = kuvaTila.objectUrl;
            return true;
        } catch (err) {
            console.warn(`${SCRIPT_NAME}: kuvan päivitys epäonnistui`, err);
            return false;
        }
    }

    function muotoileAika(ms) {
        const d = new Date(ms);
        const nyt = new Date();
        const kello = d.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
        if (d.toDateString() === nyt.toDateString()) return 'klo ' + kello;
        return `${d.getDate()}.${d.getMonth() + 1}. klo ${kello}`;
    }

    // ---------- Paneeli ----------

    function onKlikkaus({ featureId, layerName }) {
        if (layerName !== LAYER_NAME) return;
        const asema = asemat.find(a => a.id === featureId);
        if (asema) naytaPaneeli(asema);
    }

    function lisaaTyylit() {
        if (document.getElementById('wme-kelikamerat-css')) return;
        const style = document.createElement('style');
        style.id = 'wme-kelikamerat-css';
        style.textContent = `
#wme-kelikamerat-panel{position:fixed;z-index:1000;background:#fff;border:1px solid #c8c8c8;
 border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.3);font-family:"Rubik",Arial,sans-serif;
 font-size:12px;overflow:hidden;user-select:none}
#wme-kelikamerat-panel.kk-raahaa{opacity:.92}
#wme-kelikamerat-panel .kk-head{display:flex;align-items:center;gap:6px;padding:8px 10px;
 background:#0b6ec9;color:#fff;font-weight:600;cursor:move;touch-action:none}
#wme-kelikamerat-panel .kk-head.kk-vika{background:#6b7480}
#wme-kelikamerat-panel .kk-head span.kk-otsikko{flex:1;overflow:hidden;text-overflow:ellipsis;
 white-space:nowrap}
#wme-kelikamerat-panel .kk-btn{cursor:pointer;font-size:13px;line-height:1;padding:2px 6px;
 border-radius:4px;opacity:.85}
#wme-kelikamerat-panel .kk-btn:hover{background:rgba(255,255,255,.2);opacity:1}
#wme-kelikamerat-panel .kk-btn.on{background:rgba(255,255,255,.3);opacity:1}
#wme-kelikamerat-panel .kk-meta{padding:4px 10px;color:#666;background:#f8f9fb;font-size:11px}
#wme-kelikamerat-panel .kk-meta.kk-piilossa{display:none}
#wme-kelikamerat-panel .kk-varoitus{padding:5px 10px;background:#fdf3d8;color:#7a5c00;font-size:11px}
#wme-kelikamerat-panel .kk-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:6px 8px;background:#f2f4f7}
#wme-kelikamerat-panel .kk-tab{cursor:pointer;padding:3px 8px;border:1px solid #c8c8c8;
 border-radius:12px;background:#fff;font-size:11px}
#wme-kelikamerat-panel .kk-tab.on{background:#0b6ec9;color:#fff;border-color:#0b6ec9}
#wme-kelikamerat-panel img{display:block;width:100%;background:#111;min-height:140px}
#wme-kelikamerat-panel .kk-kelaus{display:flex;align-items:center;gap:8px;padding:6px 10px;
 background:#f2f4f7;border-top:1px solid #e0e3e7}
#wme-kelikamerat-panel .kk-kelaus input[type=range]{flex:1;accent-color:#0b6ec9}
#wme-kelikamerat-panel .kk-play{cursor:pointer;width:22px;height:22px;flex:0 0 22px;
 display:flex;align-items:center;justify-content:center;border:1px solid #c8c8c8;
 border-radius:50%;background:#fff;color:#0b6ec9;font-size:11px;line-height:1}
#wme-kelikamerat-panel .kk-play:hover{background:#e8f1fb}
#wme-kelikamerat-panel .kk-play.kk-poissa{opacity:.4;cursor:default}
#wme-kelikamerat-panel .kk-kelaus .kk-aika{min-width:104px;text-align:right;
 font-variant-numeric:tabular-nums;color:#555}
#wme-kelikamerat-panel .kk-kelaus .kk-aika.kk-nyt{color:#0b6ec9;font-weight:600}
#wme-kelikamerat-panel .kk-foot{padding:6px 10px;display:flex;justify-content:space-between;
 align-items:center;color:#666;font-size:11px;gap:8px;user-select:text}
#wme-kelikamerat-panel .kk-foot a{color:#0b6ec9;white-space:nowrap}
#wme-kelikamerat-panel .kk-kahva{position:absolute;right:0;bottom:0;width:18px;height:18px;
 cursor:nwse-resize;touch-action:none;
 background:linear-gradient(135deg,transparent 50%,#b0b6bd 50%,#b0b6bd 60%,transparent 60%,
 transparent 72%,#b0b6bd 72%,#b0b6bd 82%,transparent 82%)}
`;
        document.head.appendChild(style);
    }

    let paivitysAjastin = null;

    function suljePaneeli() {
        avoinAsema = null;
        if (paivitysAjastin) { clearInterval(paivitysAjastin); paivitysAjastin = null; }
        vapautaObjectUrl();
        tyhjennaKehykset();
        kuvaTila.url = null;
        kuvaTila.etag = null;
        const el = document.getElementById('wme-kelikamerat-panel');
        if (el) el.remove();
    }

    async function naytaPaneeli(asema) {
        suljePaneeli();
        avoinAsema = asema;

        const panel = document.createElement('div');
        panel.id = 'wme-kelikamerat-panel';
        panel.style.width = nykyinenLeveys() + 'px';

        const head = document.createElement('div');
        head.className = 'kk-head' + (asema.vika ? ' kk-vika' : '');
        const otsikko = document.createElement('span');
        otsikko.className = 'kk-otsikko';
        otsikko.textContent = asema.nimi || asema.id;

        const pienenna = nappi('−', 'Pienennä ikkunaa', () => { asetaLeveys(nykyinenLeveys() * 0.85, true); sijoitaPaneeli(); });
        const suurenna = nappi('+', 'Suurenna ikkunaa', () => { asetaLeveys(nykyinenLeveys() * 1.18, true); sijoitaPaneeli(); });
        const palauta = nappi('⌖', 'Palauta koko ja sijainti', () => {
            ui.leveys = null; ui.left = null; ui.top = null;
            tallennaUi();
            asetaLeveys(oletusLeveys());
            sijoitaPaneeli();
        });
        const close = nappi('×', 'Sulje', suljePaneeli);

        head.append(otsikko, pienenna, suurenna, palauta, close);

        const meta = document.createElement('div');
        meta.className = 'kk-meta';
        meta.textContent = 'Ladataan kameran tietoja…';

        const tabs = document.createElement('div');
        tabs.className = 'kk-tabs';

        const img = document.createElement('img');

        const kelaus = document.createElement('div');
        kelaus.className = 'kk-kelaus';
        const liuku = document.createElement('input');
        liuku.type = 'range';
        liuku.min = '0';
        // Ennen historian latausta käytetään näennäisasteikkoa, jotta nuppi
        // on oikeassa laidassa eli nykyhetkessä heti paneelin avautuessa.
        liuku.max = '100';
        liuku.value = '100';
        liuku.step = '1';
        liuku.title = 'Kelaa viimeisen 24 tunnin kuvia';
        const playNappi = document.createElement('div');
        playNappi.className = 'kk-play';
        playNappi.textContent = '▶';
        playNappi.title = 'Toista historiakuvat';
        const aikaTeksti = document.createElement('span');
        aikaTeksti.className = 'kk-aika kk-nyt';
        aikaTeksti.textContent = 'nyt';
        kelaus.append(playNappi, liuku, aikaTeksti);

        const foot = document.createElement('div');
        foot.className = 'kk-foot';
        const linkki = document.createElement('a');
        linkki.target = '_blank';
        linkki.rel = 'noopener';
        linkki.textContent = 'Avaa Liikennetilanteessa';
        linkki.href = FT_BASE + '?cameraId=' + encodeURIComponent(asema.id);
        const lahde = document.createElement('span');
        lahde.textContent = 'Fintraffic / Digitraffic';
        foot.append(linkki, lahde);

        const kahva = document.createElement('div');
        kahva.className = 'kk-kahva';
        kahva.title = 'Muuta ikkunan kokoa';

        panel.append(head, meta);
        if (asema.vika) {
            const varoitus = document.createElement('div');
            varoitus.className = 'kk-varoitus';
            varoitus.textContent = asema.keruu === 'REMOVED_TEMPORARILY'
                ? 'Kamera on tilapäisesti poissa keruusta – kuva voi olla vanha tai puuttua.'
                : 'Kamerassa on vahvistettu vika – kuva voi olla vanha tai puuttua.';
            panel.append(varoitus);
        }
        panel.append(tabs, img, kelaus, foot, kahva);
        document.body.appendChild(panel);

        teeRaahattavaksi(panel, head);
        teeKoonMuutos(panel, kahva);
        sijoitaPaneeli();

        let tiedot;
        try {
            tiedot = await haeAsemanTiedot(asema.id);
        } catch (err) {
            meta.classList.remove('kk-piilossa');
            meta.textContent = 'Kameran tietojen haku epäonnistui.';
            console.error(SCRIPT_NAME, err);
            return;
        }
        if (avoinAsema !== asema) return;

        otsikko.textContent = tiedot.nimi;
        // Tieosoite, kunta ja tunnus ovat ylläpitotietoa: ne eivät vie tilaa
        // paneelista vaan löytyvät otsikon työkaluvihjeestä.
        otsikko.title = [tiedot.tekninen, tiedot.tieosoite, tiedot.kunta, tiedot.id]
            .filter(Boolean).join('\n');
        meta.classList.add('kk-piilossa');

        // --- kelauksen tila ---
        // Liukusäädin on aina näkyvissä. Oikea ääriasento tarkoittaa nykyhetkeä,
        // ja historialista haetaan vasta kun säätimeen tartutaan tai sen päällä
        // viivytään hetki.
        let valittuPreset = tiedot.presets[0] || null;
        let historiaRivit = [];
        let pysaytaJosKay = () => {}; // korvataan kun toisto on määritelty
        let historiaPyynto = null;
        let hoverAjastin = null;

        const nytKohdalla = () => historiaRivit.length === 0
            || Number(liuku.value) >= historiaRivit.length - 1;

        const merkitseNyt = () => {
            aikaTeksti.textContent = 'nyt';
            aikaTeksti.classList.add('kk-nyt');
        };

        const merkitseAika = (ms) => {
            aikaTeksti.textContent = muotoileAika(ms);
            aikaTeksti.classList.remove('kk-nyt');
        };

        const naytaKohta = (i) => {
            if (nytKohdalla()) {
                merkitseNyt();
                if (valittuPreset) asetaKuva(img, valittuPreset.imageUrl);
                return;
            }
            const rivi = historiaRivit[i];
            if (!rivi) return;
            merkitseAika(rivi.aika);
            asetaKuva(img, rivi.url);
        };

        const lataaHistoria = () => {
            if (historiaPyynto) return historiaPyynto;
            if (!valittuPreset) return Promise.resolve(false);

            historiaPyynto = (async () => {
                try {
                    const presets = await haeHistoria(tiedot.id);
                    if (avoinAsema !== asema) return false;
                    historiaRivit = presets[valittuPreset.id] || [];
                } catch (err) {
                    console.warn(`${SCRIPT_NAME}: historian haku epäonnistui`, err);
                    historiaRivit = [];
                    liuku.disabled = true;
                    liuku.title = 'Historiakuvia ei saatu haettua';
                    liuku.value = liuku.max;
                    return false;
                }
                if (!historiaRivit.length) {
                    liuku.disabled = true;
                    liuku.title = 'Tälle esiasennolle ei ole historiakuvia';
                    liuku.value = liuku.max;
                    return false;
                }
                liuku.disabled = false;
                liuku.title = `Kelaa taaksepäin (${historiaRivit.length} kuvaa / 24 h)`;
                liuku.max = String(historiaRivit.length - 1);
                liuku.value = String(historiaRivit.length - 1);
                return true;
            })();

            return historiaPyynto;
        };

        // Esilataus, jotta ensimmäinen veto toimii heti.
        kelaus.addEventListener('pointerenter', () => {
            if (historiaPyynto) return;
            hoverAjastin = setTimeout(lataaHistoria, 150);
        });
        kelaus.addEventListener('pointerleave', () => {
            if (hoverAjastin) { clearTimeout(hoverAjastin); hoverAjastin = null; }
        });
        liuku.addEventListener('pointerdown', e => { e.stopPropagation(); pysaytaJosKay(); lataaHistoria(); });
        liuku.addEventListener('focus', lataaHistoria);
        liuku.addEventListener('keydown', lataaHistoria);

        liuku.addEventListener('input', () => {
            if (nytKohdalla()) merkitseNyt();
            else merkitseAika((historiaRivit[Number(liuku.value)] || {}).aika || Date.now());
        });
        liuku.addEventListener('change', () => naytaKohta(Number(liuku.value)));

        // --- toisto ---
        let toistoKay = false;
        let toistoAjo = 0;

        const pysayta = () => {
            toistoKay = false;
            toistoAjo++;
            playNappi.textContent = '▶';
            playNappi.title = 'Toista historiakuvat';
        };

        pysaytaJosKay = () => { if (toistoKay) pysayta(); };

        const toistaAlkaen = async (alku) => {
            const ajo = ++toistoAjo;
            toistoKay = true;
            playNappi.textContent = '❚❚';
            playNappi.title = 'Pysäytä toisto';

            for (let i = alku; i < historiaRivit.length; i++) {
                if (!toistoKay || ajo !== toistoAjo || avoinAsema !== asema) return;
                if (document.hidden) { pysayta(); return; }

                const alkuHetki = performance.now();
                let src;
                try {
                    src = await haeKehys(historiaRivit[i].url);
                } catch (err) {
                    continue; // yksittäinen puuttuva kehys ei keskeytä toistoa
                }
                if (!toistoKay || ajo !== toistoAjo) return;

                img.src = src;
                liuku.value = String(i);
                merkitseAika(historiaRivit[i].aika);

                // Esilataus taustalla, jotta seuraavat kehykset ovat valmiina.
                const loppu = Math.min(i + ESILATAUS, historiaRivit.length - 1);
                for (let j = i + 1; j <= loppu; j++) {
                    haeKehys(historiaRivit[j].url).catch(() => {});
                }

                const kulunut = performance.now() - alkuHetki;
                if (kulunut < TOISTO_MS) await odota(TOISTO_MS - kulunut);
            }

            if (ajo === toistoAjo) {
                pysayta();
                naytaKohta(historiaRivit.length - 1); // päättyy live-kuvaan
            }
        };

        playNappi.addEventListener('pointerdown', e => e.stopPropagation());
        playNappi.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (toistoKay) { pysayta(); return; }
            const onnistui = await lataaHistoria();
            if (!onnistui || !historiaRivit.length) {
                playNappi.classList.add('kk-poissa');
                playNappi.title = 'Historiakuvia ei ole saatavilla';
                return;
            }
            let alku = Number(liuku.value);
            if (!Number.isFinite(alku) || alku >= historiaRivit.length - 1) alku = 0;
            toistaAlkaen(alku);
        });

        const valitse = (p, tab) => {
            tabs.querySelectorAll('.kk-tab').forEach(t => t.classList.remove('on'));
            tab.classList.add('on');
            valittuPreset = p;
            linkki.href = FT_BASE
                + '?cameraId=' + encodeURIComponent(tiedot.id)
                + '&cameraPanId=' + encodeURIComponent(p.id);
            pysaytaJosKay();
            playNappi.classList.remove('kk-poissa');
            playNappi.title = 'Toista historiakuvat';
            // Uusi esiasento aloitetaan aina nykyhetkestä.
            historiaRivit = [];
            historiaPyynto = null;
            liuku.disabled = false;
            liuku.max = '100';
            liuku.value = '100';
            liuku.title = 'Kelaa viimeisen 24 tunnin kuvia';
            merkitseNyt();
            asetaKuva(img, p.imageUrl);
        };

        tiedot.presets.forEach((p, i) => {
            const tab = document.createElement('div');
            tab.className = 'kk-tab';
            tab.textContent = p.nimi;
            tab.title = [p.resoluutio, p.id].filter(Boolean).join(' · ');
            tab.onclick = () => valitse(p, tab);
            tabs.appendChild(tab);
            if (i === 0) valitse(p, tab);
        });

        // Automaattinen päivitys vain live-tilassa ja kun välilehti on näkyvissä.
        paivitysAjastin = setInterval(async () => {
            if (!nytKohdalla() || document.hidden) return;
            if (!document.getElementById('wme-kelikamerat-panel')) return;
            const paivittyi = await paivitaKuva(img);
            if (paivittyi) loki('Kuva päivittyi:', valittuPreset && valittuPreset.id);
        }, PAIVITYSVALI_MS);

        sijoitaPaneeli();
        img.addEventListener('load', sijoitaPaneeli, { once: true });
    }

    function nappi(merkki, otsikko, toiminto) {
        const b = document.createElement('div');
        b.className = 'kk-btn';
        b.textContent = merkki;
        b.title = otsikko;
        b.addEventListener('pointerdown', e => e.stopPropagation()); // ei käynnistä raahausta
        b.addEventListener('click', e => { e.stopPropagation(); toiminto(); });
        return b;
    }

    // ---------- Raahaus ----------

    function teeRaahattavaksi(panel, kahva) {
        let alkuX = 0, alkuY = 0, alkuLeft = 0, alkuTop = 0, raahaa = false;

        kahva.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            raahaa = true;
            alkuX = e.clientX;
            alkuY = e.clientY;
            const r = panel.getBoundingClientRect();
            alkuLeft = r.left;
            alkuTop = r.top;
            panel.classList.add('kk-raahaa');
            kahva.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        kahva.addEventListener('pointermove', e => {
            if (!raahaa) return;
            const r = rajaa(panel, alkuLeft + (e.clientX - alkuX), alkuTop + (e.clientY - alkuY));
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
        });

        const lopeta = e => {
            if (!raahaa) return;
            raahaa = false;
            panel.classList.remove('kk-raahaa');
            try { kahva.releasePointerCapture(e.pointerId); } catch (err) { /* ohitetaan */ }
            const r = panel.getBoundingClientRect();
            ui.left = Math.round(r.left);
            ui.top = Math.round(r.top);
            tallennaUi();
        };
        kahva.addEventListener('pointerup', lopeta);
        kahva.addEventListener('pointercancel', lopeta);
    }

    // ---------- Koon muutos ----------

    function teeKoonMuutos(panel, kahva) {
        let alkuX = 0, alkuW = 0, muuttaa = false;

        kahva.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            muuttaa = true;
            alkuX = e.clientX;
            alkuW = panel.offsetWidth;
            kahva.setPointerCapture(e.pointerId);
            e.preventDefault();
            e.stopPropagation();
        });

        kahva.addEventListener('pointermove', e => {
            if (!muuttaa) return;
            asetaLeveys(alkuW + (e.clientX - alkuX));
            sijoitaPaneeli();
        });

        const lopeta = e => {
            if (!muuttaa) return;
            muuttaa = false;
            try { kahva.releasePointerCapture(e.pointerId); } catch (err) { /* ohitetaan */ }
            tallennaUi();
        };
        kahva.addEventListener('pointerup', lopeta);
        kahva.addEventListener('pointercancel', lopeta);
    }
})();
