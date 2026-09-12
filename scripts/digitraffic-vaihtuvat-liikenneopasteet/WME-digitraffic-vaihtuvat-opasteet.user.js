// ==UserScript==
// @name         WME Vaihtuvat opasteet (Digitraffic)
// @namespace    https://github.com/samisepp/Waze-Finland-Scripts
// @version      0.6.0
// @description  Näyttää Fintrafficin vaihtuvat nopeusrajoitus- ja varoitusopasteet WME:ssä.
// @author       samisepp
// @match        https://*.waze.com/*editor*
// @exclude      https://*.waze.com/user/editor*
// @exclude      https://*.waze.com/editor/sdk/*
// @grant        GM_xmlhttpRequest
// @connect      tie.digitraffic.fi
// @connect      avoinapi.vaylapilvi.fi
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Metroseksuaali/Waze-Finland-Scripts/main/scripts/digitraffic-vaihtuvat-liikenneopasteet/WME-digitraffic-vaihtuvat-opasteet.user.js
// @downloadURL  https://raw.githubusercontent.com/Metroseksuaali/Waze-Finland-Scripts/main/scripts/digitraffic-vaihtuvat-liikenneopasteet/WME-digitraffic-vaihtuvat-opasteet.user.js
// ==/UserScript==

/* Data: Fintraffic / Digitraffic ja Väylävirasto, lisenssi CC BY 4.0 */

(function () {
    'use strict';

    const SCRIPT_ID = 'wme-opasteet';
    const SCRIPT_NAME = 'WME Vaihtuvat opasteet';
    const VERSION = '0.6.0';
    const LAYER_NOPEUS = 'wme_opasteet_nopeus';
    const LAYER_VAROITUS = 'wme_opasteet_varoitus';
    const CB_NOPEUS = 'Vaihtuvat nopeusrajoitukset';
    const CB_VAROITUS = 'Vaihtuvat varoitusopasteet';
    const DT_USER = 'samisepp/WME-Opasteet ' + VERSION;
    const API = 'https://tie.digitraffic.fi/api/variable-sign/v1/signs';
    const KUVA_API = 'https://tie.digitraffic.fi/api/variable-sign/v1/images/';
    const HISTORIA_API = 'https://tie.digitraffic.fi/api/variable-sign/v1/signs/history';
    const HISTORIA_MAARA = 5;
    // Laitteet tuottavat sekuntien mittaisia testivälähdyksiä, jotka eivät ole
    // todellisia muutoksia. Tätä lyhyemmät tilat karsitaan listalta.
    const OHIMENEVA_MS = 2 * 60 * 1000;

    const WFS_BASE = 'https://avoinapi.vaylapilvi.fi/vaylatiedot/ows';
    const WFS_LAYER = 'tiestotiedot:tieosoiteverkko';
    const SUUNTA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const HAKU_SADE_M = 120;
    const SEKTORI_PUOLIKULMA = 16;
    const SEKTORI_PIKSELIT = 52;
    const LAYER_SUUNTA = 'wme_opasteet_suunta';

    const ILMANSUUNNAT = [
        'pohjoiseen', 'koilliseen', 'itään', 'kaakkoon',
        'etelään', 'lounaaseen', 'länteen', 'luoteeseen'
    ];

    const SKEEMA = 'v1';
    const UI_KEY = 'wmeOpasteet_ui';
    // Huom: kaikki SKEEMA-riippuvaiset avaimet määritellään vasta tässä,
    // muuten const jää temporal dead zoneen ja koko skripti kaatuu.
    const CACHE_KEY_SUUNTA = `wmeOpasteet_${SKEEMA}_suunta_`;

    const MIN_ZOOM = 12;
    const MAX_MERKKEJA = 500;
    const PAIVITYSVALI_MS = 5 * 60 * 1000;
    const DATA_TUOREUS_MS = 60 * 1000;
    const MIN_W = 320;
    const REUNA = 10;

    // Ennalta piirretyt nopeusarvot. Muut arvot saavat kysymysmerkki-ikonin,
    // koska styleRules on kiinnitettävä tason luontihetkellä.
    const NOPEUDET = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];

    const SUUNNAT = { INCREASING: 'Kasvavaan suuntaan', DECREASING: 'Laskevaan suuntaan' };
    const AJORADAT = { RIGHT: 'Oikea ajorata', LEFT: 'Vasen ajorata', NORMAL: 'Ajorata' };

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const loki = (...a) => console.log('[Opasteet]', ...a);

    let sdk = null;
    let opasteet = [];
    let haettuHetki = 0;
    let nopeusNakyy = true;
    let varoitusNakyy = true;
    let avoinOpaste = null;
    let paivitysAjastin = null;
    const tuntemattomat = new Set(); // lokitetaan kerran per arvo

    const ui = Object.assign({ leveys: null, left: null, top: null }, lueUi());

    // ---------- Ikonit ----------

    const svg = (sisalto, koko) => 'data:image/svg+xml;base64,' + btoa(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${koko}" height="${koko}" ` +
        `viewBox="0 0 ${koko} ${koko}">${sisalto}</svg>`);

    function nopeusIkoni(arvo, luotettava) {
        const rengas = luotettava ? '#d0021b' : '#9aa0a6';
        const teksti = luotettava ? '#111111' : '#6b7480';
        const koko = String(arvo).length > 2 ? 12 : 14;
        return svg(
            `<circle cx="16" cy="16" r="13.5" fill="#ffffff" stroke="${rengas}" stroke-width="4.5"/>` +
            `<text x="16" y="16.5" text-anchor="middle" dominant-baseline="central" ` +
            `font-family="Arial,Helvetica,sans-serif" font-size="${koko}" font-weight="bold" ` +
            `fill="${teksti}">${arvo}</text>`, 32);
    }

    function varoitusIkoni(luotettava) {
        const reuna = luotettava ? '#d0021b' : '#9aa0a6';
        const merkki = luotettava ? '#111111' : '#6b7480';
        return svg(
            `<path d="M16 3 L29 27 L3 27 Z" fill="#ffffff" stroke="${reuna}" ` +
            `stroke-width="3" stroke-linejoin="round"/>` +
            `<path d="M16 12 v7" stroke="${merkki}" stroke-width="2.8" stroke-linecap="round"/>` +
            `<circle cx="16" cy="23.5" r="1.6" fill="${merkki}"/>`, 32);
    }

    // Opaste on pimeänä: sama muoto kuin toimivalla, mutta harmaana ja tyhjänä.
    function pimeaNopeusIkoni() {
        return svg(
            '<circle cx="16" cy="16" r="13.5" fill="#ffffff" stroke="#9aa0a6" stroke-width="4.5"/>',
            32);
    }

    function pimeaVaroitusIkoni() {
        return svg(
            '<path d="M16 3 L29 27 L3 27 Z" fill="#ffffff" stroke="#9aa0a6" ' +
            'stroke-width="3" stroke-linejoin="round"/>', 32);
    }

    // Lämpötilaopaste: neutraali harmaa laatta, ei varoitusmuotoa.
    function lampoIkoni() {
        return svg(
            '<rect x="4" y="7" width="24" height="18" rx="3" fill="#eceff1" ' +
            'stroke="#9aa0a6" stroke-width="2"/>' +
            '<text x="16" y="16.5" text-anchor="middle" dominant-baseline="central" ' +
            'font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="bold" ' +
            'fill="#6b7480">\u00b0C</text>', 32);
    }

    function tuntematonIkoni(luotettava) {
        const rengas = luotettava ? '#d0021b' : '#9aa0a6';
        return svg(
            `<circle cx="16" cy="16" r="13.5" fill="#ffffff" stroke="${rengas}" stroke-width="4.5"/>` +
            '<text x="16" y="16.5" text-anchor="middle" dominant-baseline="central" ' +
            'font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="bold" ' +
            'fill="#111111">?</text>', 32);
    }

    // Avain -> ikoni. Piirteen properties.ikoni valitsee tyylisäännön.
    const IKONIT = (() => {
        const m = {};
        for (const v of NOPEUDET) {
            m[`n${v}`] = nopeusIkoni(v, true);
            m[`n${v}_e`] = nopeusIkoni(v, false);
        }
        m.varoitus = varoitusIkoni(true);
        m.varoitus_e = varoitusIkoni(false);
        m.lampo = lampoIkoni();
        m.lampo_e = lampoIkoni();
        m.pimea_n = pimeaNopeusIkoni();
        m.pimea_n_e = pimeaNopeusIkoni();
        m.pimea_v = pimeaVaroitusIkoni();
        m.pimea_v_e = pimeaVaroitusIkoni();
        m.tuntematon = tuntematonIkoni(true);
        m.tuntematon_e = tuntematonIkoni(false);
        return m;
    })();

    let predikaattiLokitettu = false;

    const ikoniTyyli = (ikoni, lapinakyvyys) => ({
        externalGraphic: ikoni,
        graphicWidth: 32,
        graphicHeight: 32,
        graphicXOffset: -16,
        graphicYOffset: -16,
        graphicOpacity: lapinakyvyys,
        cursor: 'pointer'
    });

    // Säännöt ovat toisensa poissulkevia, joten niiden keskinäinen järjestys
    // ei vaikuta lopputulokseen. Ehdotonta oletussääntöä ei käytetä, koska se
    // ylikirjoittaisi tarkemmat säännöt.
    function tyylisaannot() {
        const saannot = Object.entries(IKONIT).map(([avain, ikoni]) => ({
            predicate: (p) => {
                if (!predikaattiLokitettu) {
                    predikaattiLokitettu = true;
                    loki('Tyylipredikaatti saa parametrin:', p);
                }
                return !!p && p.ikoni === avain;
            },
            style: ikoniTyyli(ikoni,
                (avain.startsWith('pimea') || avain.startsWith('lampo'))
                    ? 0.6
                    : (avain.endsWith('_e') ? 0.65 : 1))
        }));

        // Varasääntö vain tunnistamattomalle avaimelle.
        saannot.push({
            predicate: (p) => !p || !Object.prototype.hasOwnProperty.call(IKONIT, p.ikoni),
            style: ikoniTyyli(IKONIT.tuntematon, 0.8)
        });
        return saannot;
    }

    // ---------- Käynnistys ----------

    win.SDK_INITIALIZED.then(init).catch(err => console.error(SCRIPT_NAME, err));

    async function init() {
        sdk = win.getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME });
        if (!sdk.State.isReady()) {
            await sdk.Events.once({ eventName: 'wme-ready' });
        }

        siivoaVanhat();
        lisaaTyylit();

        // Suuntasektori omalle tasolleen merkkien alle.
        sdk.Map.addLayer({
            layerName: LAYER_SUUNTA,
            styleRules: [{
                predicate: () => true,
                style: {
                    fillColor: '#0b6ec9', fillOpacity: 0.35,
                    strokeColor: '#ffffff', strokeWidth: 1, strokeOpacity: 0.9
                }
            }]
        });
        sdk.Map.setLayerVisibility({ layerName: LAYER_SUUNTA, visibility: true });

        for (const nimi of [LAYER_VAROITUS, LAYER_NOPEUS]) {
            sdk.Map.addLayer({ layerName: nimi, styleRules: tyylisaannot(), zIndexing: true });
            sdk.Map.setLayerVisibility({ layerName: nimi, visibility: true });
            sdk.Events.trackLayerEvents({ layerName: nimi });
        }

        sdk.LayerSwitcher.addLayerCheckbox({ name: CB_NOPEUS, isChecked: true });
        sdk.LayerSwitcher.addLayerCheckbox({ name: CB_VAROITUS, isChecked: true });
        sdk.Events.on({
            eventName: 'wme-layer-checkbox-toggled',
            eventHandler: ({ name, checked }) => {
                if (name === CB_NOPEUS) {
                    nopeusNakyy = checked;
                    sdk.Map.setLayerVisibility({ layerName: LAYER_NOPEUS, visibility: checked });
                } else if (name === CB_VAROITUS) {
                    varoitusNakyy = checked;
                    sdk.Map.setLayerVisibility({ layerName: LAYER_VAROITUS, visibility: checked });
                } else return;
                if (checked) piirra(); else suljePaneeli();
            }
        });

        sdk.Events.on({ eventName: 'wme-layer-feature-clicked', eventHandler: onKlikkaus });
        sdk.Events.on({
            eventName: 'wme-map-move-end',
            eventHandler: () => { varmistaData(); piirra(); piirraSektori(); sijoitaPaneeli(); }
        });

        window.addEventListener('resize', () => { asetaLeveys(nykyinenLeveys()); sijoitaPaneeli(); });

        win.WMEOpasteet = {
            opasteet: () => opasteet,
            raaka: (id) => {
                const o = opasteet.find(x => x.id === id);
                if (!o) { loki('Tuntematon laitetunnus:', id); return null; }
                loki('Raakaominaisuudet', id, o.raaka);
                return o.raaka;
            },
            pimeat: () => opasteet.filter(onPimea).map(o => o.id),
            ajosuunta: (id) => {
                const o = opasteet.find(x => x.id === id);
                return o ? haeAjosuunta(o).then(k => { loki('Ajosuunta', id, k); return k; }) : null;
            },
            historia: (id) => haeHistoria(id).then(r => { loki('Historia', id, r); return r; }),
            lampotilat: () => opasteet.filter(o => o.lampotila)
                .map(o => ({ id: o.id, rivit: o.rivit })),
            paivita: () => { haettuHetki = 0; return varmistaData(); },
        };

        await varmistaData();
        piirra();

        paivitysAjastin = setInterval(() => {
            if (document.hidden) return;
            haettuHetki = 0;
            varmistaData().then(piirra);
        }, PAIVITYSVALI_MS);
    }

    // ---------- Verkko ----------
    // === YHTEINEN: verkkokutsut ===

    function gmGet(url, asetukset) {
        const o = asetukset || {};
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: o.responseType || 'text',
                headers: Object.assign({ 'Digitraffic-User': DT_USER }, o.headers || {}),
                onload: r => (r.status >= 200 && r.status < 300)
                    ? resolve(r)
                    : reject(new Error('HTTP ' + r.status + ' – ' + String(r.responseText).slice(0, 200))),
                onerror: () => reject(new Error('Verkkovirhe: ' + url)),
                ontimeout: () => reject(new Error('Aikakatkaisu: ' + url))
            });
        });
    }
    // === /YHTEINEN ===

    function lueUi() {
        try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; }
        catch (e) { return {}; }
    }

    function tallennaUi() {
        try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); }
        catch (e) { /* ei kriittistä */ }
    }

    function siivoaVanhat() {
        const uusi = `wmeOpasteet_${SKEEMA}_`;
        let n = 0;
        for (const avain of Object.keys(localStorage)) {
            if (!avain.startsWith('wmeOpasteet_')) continue;
            if (avain === UI_KEY || avain.startsWith(uusi)) continue;
            localStorage.removeItem(avain);
            n++;
        }
        if (n) loki(`Poistettiin ${n} vanhentunutta välimuistiavainta.`);
    }

    // ---------- Data ----------

    // Koordinaatit tarkistetaan, koska tästä lähteestä on aiemmin tullut
    // leveys- ja pituusasteet väärinpäin.
    function koordinaatit(geometry, id) {
        const c = (geometry && geometry.coordinates) || [];
        let lon = c[0], lat = c[1];
        if (typeof lon !== 'number' || typeof lat !== 'number') return null;

        if (Math.abs(lon) > 1000 || Math.abs(lat) > 1000) {
            console.warn(`[Opasteet] ${id}: koordinaatit eivät ole WGS84 (${lon}, ${lat})`);
            return null;
        }
        // Suomi: pituus 19–32, leveys 59–70. Jos arvot ovat toisin päin, vaihdetaan.
        if (lon > 55 && lon < 75 && lat > 18 && lat < 33) {
            console.warn(`[Opasteet] ${id}: koordinaatit näyttävät olevan väärinpäin, vaihdetaan.`);
            [lon, lat] = [lat, lon];
        }
        return { lon, lat };
    }

    // textRows sisältää objekteja, ei merkkijonoja. Kentän nimeä ei ole
    // dokumentoitu, joten kokeillaan tunnetut vaihtoehdot ja lokitetaan
    // rakenne kerran, jos mikään ei osu.
    const RIVIKENTAT = ['text', 'value', 'rowText', 'screenText', 'content', 'row'];
    let riviRakenneLokitettu = false;

    function riviTeksti(rivi) {
        if (rivi == null) return '';
        if (typeof rivi === 'string') return rivi.trim();
        if (typeof rivi === 'number') return String(rivi);
        if (typeof rivi === 'object') {
            for (const kentta of RIVIKENTAT) {
                if (typeof rivi[kentta] === 'string') return rivi[kentta].trim();
            }
            // Varalta: ensimmäinen merkkijonoarvoinen kenttä.
            for (const arvo of Object.values(rivi)) {
                if (typeof arvo === 'string' && arvo.trim()) return arvo.trim();
            }
            if (!riviRakenneLokitettu) {
                riviRakenneLokitettu = true;
                loki('textRows-rivin rakennetta ei tunnistettu:', rivi);
            }
        }
        return '';
    }

    // --- Lämpötilaopasteiden tunnistus ---
    // Taulu, joka näyttää vain ilman ja tien lämpötilan, ei sisällä
    // editorille käyttökelpoista tietoa.

    // Tunnistus vaatii yksiselitteisen vihjeen, ettei "TIE 3" mene
    // lämpötilaksi pelkän avainsanan ja numeron perusteella.
    const LAMPO_VIHJE = /(°|ilma|luft|lämpötila|lampotila|temperatur)/i;

    // Taulut ovat usein kaksikielisiä, joten mukana ovat myös ruotsin ja
    // englannin vastineet. Pisimmät muodot ensin.
    const LAMPO_SANAT = [
        'ilman', 'ilma',
        'tienpinnan', 'tienpinta', 'tienpinnassa', 'tien', 'tie',
        'lämpötila', 'lampotila', 'keli',
        'vägbanan', 'vägbana', 'vagbana', 'vägytan', 'vägyta', 'vägen', 'väg', 'vag',
        'luften', 'luft', 'temperatur',
        'temperature', 'surface', 'road', 'air', 'temp'
    ];
    const LAMPO_SANAT_RE = new RegExp('\\b(' + LAMPO_SANAT.join('|') + ')\\b', 'g');

    const lahelta = new Set();

    function lampotilaRivi(teksti) {
        const rivi = String(teksti).toLowerCase().replace(/\s+/g, ' ').trim();
        if (!rivi) return true;
        const jaannos = rivi
            .replace(LAMPO_SANAT_RE, ' ')
            .replace(/[-+−–]?\d{1,3}([.,]\d)?\s*(°\s*c|°|c\b)?/g, ' ')
            .replace(/[:.,;/|°]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (jaannos && LAMPO_VIHJE.test(rivi) && !lahelta.has(jaannos)) {
            lahelta.add(jaannos);
            loki('Lämpötilariviltä jäi tunnistamaton osa:', JSON.stringify(jaannos), '–', teksti);
        }
        return jaannos === '';
    }

    function vainLampotila(rivit) {
        if (!rivit.length) return false;
        const kaikki = rivit.join(' ');
        if (!LAMPO_VIHJE.test(kaikki)) return false;
        return rivit.every(lampotilaRivi);
    }

    // Rivi on tyhjä, jos siinä ei ole yhtään kirjainta, numeroa tai [symbolia].
    function riviTyhja(teksti) {
        const t = String(teksti || '').trim();
        if (!t) return true;
        return !/[\p{L}\p{N}]/u.test(t) && !/\[[^\]]+\]/.test(t);
    }

    // Rivit järjestetään näytön ja rivinumeron mukaan, jos kentät ovat olemassa.
    function jarjestaRivit(rivit) {
        const numero = (r, kentta) => (r && typeof r === 'object' && Number.isFinite(r[kentta]))
            ? r[kentta] : 0;
        return rivit.slice().sort((a, b) =>
            (numero(a, 'screen') - numero(b, 'screen'))
            || (numero(a, 'rowNumber') - numero(b, 'rowNumber')));
    }

    function jasenna(f) {
        const p = f.properties || {};
        const id = f.id || p.id || p.deviceId;
        const sijainti = koordinaatit(f.geometry, id);
        if (!sijainti) return null;

        const arvo = (p.displayValue === null || p.displayValue === undefined)
            ? '' : String(p.displayValue).trim();
        const rivit = Array.isArray(p.textRows)
            ? jarjestaRivit(p.textRows).map(riviTeksti).filter(t => !riviTyhja(t))
            : [];
        const luotettava = p.reliability === 'NORMAL';
        if (!luotettava && p.reliability) {
            if (!tuntemattomat.has('rel:' + p.reliability)) {
                tuntemattomat.add('rel:' + p.reliability);
                loki('reliability-arvo havaittu:', p.reliability);
            }
        }

        const tyyppi = p.type || 'TUNTEMATON';
        if (tyyppi !== 'SPEEDLIMIT' && tyyppi !== 'WARNING' && !tuntemattomat.has('type:' + tyyppi)) {
            tuntemattomat.add('type:' + tyyppi);
            loki('Tuntematon opastetyyppi:', tyyppi);
        }

        return {
            id,
            tyyppi,
            nopeus: tyyppi === 'SPEEDLIMIT',
            arvo,
            rivit,
            luotettava,
            reliability: p.reliability || '',
            tieosoite: p.roadAddress || '',
            suunta: p.direction || '',
            ajorata: p.carriageway || '',
            lampotila: tyyppi !== 'SPEEDLIMIT' && vainLampotila(rivit),
            voimaan: p.effectDate ? Date.parse(p.effectDate) : NaN,
            lon: sijainti.lon,
            lat: sijainti.lat,
            raaka: p
        };
    }

    // Pimeys päätellään tyypin mukaan: nopeusopasteella ratkaisee numeroarvo,
    // varoitusopasteella tekstirivit. displayValue voi sisältää varoitusopasteella
    // laitteen tilakoodin, joten sitä ei tulkita näytön sisällöksi.
    function onPimea(o) {
        if (o.nopeus) return !Number.isFinite(Number(o.arvo)) || Number(o.arvo) <= 0;
        return o.rivit.length === 0;
    }

    function ikoniAvain(o) {
        const jaannos = o.luotettava ? '' : '_e';
        if (onPimea(o)) return (o.nopeus ? 'pimea_n' : 'pimea_v') + jaannos;
        if (o.lampotila) return 'lampo' + jaannos;
        if (o.nopeus) {
            const n = Number(o.arvo);
            if (NOPEUDET.includes(n)) return `n${n}${jaannos}`;
            if (!tuntemattomat.has('nop:' + o.arvo)) {
                tuntemattomat.add('nop:' + o.arvo);
                loki('Nopeusarvo ilman omaa ikonia:', o.arvo);
            }
            return 'tuntematon' + jaannos;
        }
        return 'varoitus' + jaannos;
    }

    async function varmistaData() {
        if (Date.now() - haettuHetki < DATA_TUOREUS_MS) return;
        try {
            const r = await gmGet(API);
            const json = JSON.parse(r.responseText);
            opasteet = (json.features || []).map(jasenna).filter(Boolean);
            haettuHetki = Date.now();
            loki(`${opasteet.length} opastetta ladattu.`);
        } catch (err) {
            console.error(`${SCRIPT_NAME}: opasteiden haku epäonnistui`, err);
        }
    }

    // ---------- Ajosuunnan päättely ----------
    // Tierekisterin "kasvava/laskeva suunta" ei ole ymmärrettävä kartalla.
    // Tieosoiteverkko on digitoitu kasvavaan suuntaan, joten viivan tangentti
    // kääntää sen kompassisuunnaksi.

    const MERC_R = 6378137;
    const suuntaCache = new Map();

    function merkaattori(lon, lat) {
        return [
            MERC_R * lon * Math.PI / 180,
            MERC_R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
        ];
    }

    // Web Mercatorin yksikkö ei ole maastometri.
    const metritMerkaattorissa = (m, lat) => m / Math.cos(lat * Math.PI / 180);

    function etaisyysJanaan(px, py, a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const p2 = dx * dx + dy * dy;
        if (p2 === 0) return Math.hypot(px - a[0], py - a[1]);
        let t = ((px - a[0]) * dx + (py - a[1]) * dy) / p2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
    }

    function viivat(geometry) {
        if (!geometry) return [];
        if (geometry.type === 'LineString') return [geometry.coordinates];
        if (geometry.type === 'MultiLineString') return geometry.coordinates;
        return [];
    }

    function tienumeroKentasta(props) {
        if (!props) return null;
        for (const [avain, arvo] of Object.entries(props)) {
            const a = avain.toLowerCase();
            if (a === 'tie' || a === 'tienumero' || a === 'tienro' || a.endsWith('_tienumero')) {
                const n = Number(arvo);
                if (Number.isFinite(n)) return n;
            }
        }
        return null;
    }

    function tangenttiKulma(geojson, x, y, tienumero) {
        let paras = null;
        for (const f of (geojson.features || [])) {
            const tn = tienumeroKentasta(f.properties);
            const osuu = tienumero != null && tn != null && tn === tienumero;
            for (const line of viivat(f.geometry)) {
                for (let i = 0; i + 1 < line.length; i++) {
                    const d = etaisyysJanaan(x, y, line[i], line[i + 1]);
                    const paino = osuu ? d : d + 1e7;
                    if (!paras || paino < paras.paino) paras = { paino, a: line[i], b: line[i + 1] };
                }
            }
        }
        if (!paras) return null;
        const dx = paras.b[0] - paras.a[0];
        const dy = paras.b[1] - paras.a[1];
        if (dx === 0 && dy === 0) return null;
        return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    }

    function wfsOsoite(x, y, r, versio) {
        const yhteiset = {
            service: 'WFS',
            request: 'GetFeature',
            outputFormat: 'application/json',
            srsName: 'EPSG:3857',
            bbox: `${x - r},${y - r},${x + r},${y + r},EPSG:3857`
        };
        const par = new URLSearchParams(versio === '1.1.0'
            ? Object.assign({ version: '1.1.0', typeName: WFS_LAYER, maxFeatures: '40' }, yhteiset)
            : Object.assign({ version: '2.0.0', typeNames: WFS_LAYER, count: '40' }, yhteiset));
        return WFS_BASE + '?' + par.toString();
    }

    async function haeTieverkko(x, y, r) {
        try {
            const v = await gmGet(wfsOsoite(x, y, r, '2.0.0'));
            return JSON.parse(v.responseText);
        } catch (err) {
            const v = await gmGet(wfsOsoite(x, y, r, '1.1.0'));
            return JSON.parse(v.responseText);
        }
    }

    function tienumeroOsoitteesta(raaka) {
        const osat = String(raaka || '').trim().split(/\s+/);
        const n = Number(osat[0]);
        return Number.isFinite(n) ? n : null;
    }

    // Palauttaa opasteen ajosuunnan asteina tai null.
    async function haeAjosuunta(o) {
        if (suuntaCache.has(o.id)) return suuntaCache.get(o.id);
        const cached = lueSuuntaVälimuisti(CACHE_KEY_SUUNTA + o.id);
        if (cached && typeof cached.kulma !== 'undefined') {
            suuntaCache.set(o.id, cached.kulma);
            return cached.kulma;
        }

        const kasvava = o.suunta === 'INCREASING';
        const laskeva = o.suunta === 'DECREASING';
        if (!kasvava && !laskeva) { suuntaCache.set(o.id, null); return null; }

        const [x, y] = merkaattori(o.lon, o.lat);
        const r = metritMerkaattorissa(HAKU_SADE_M, o.lat);
        let kulma = null;
        try {
            const verkko = await haeTieverkko(x, y, r);
            const tien = tangenttiKulma(verkko, x, y, tienumeroOsoitteesta(o.tieosoite));
            if (tien !== null) kulma = laskeva ? (tien + 180) % 360 : tien;
        } catch (err) {
            console.warn(`${SCRIPT_NAME}: tieosoiteverkon haku epäonnistui (${o.id})`, err);
            return null; // ei tallenneta, yritetään myöhemmin uudelleen
        }

        suuntaCache.set(o.id, kulma);
        kirjoitaSuuntaVälimuisti(CACHE_KEY_SUUNTA + o.id, { kulma });
        return kulma;
    }

    function lueSuuntaVälimuisti(key) {
        try {
            const c = JSON.parse(localStorage.getItem(key) || 'null');
            if (c && (Date.now() - c.ts) < SUUNTA_TTL_MS) return c.data;
        } catch (e) { /* ohitetaan */ }
        return null;
    }

    function kirjoitaSuuntaVälimuisti(key, data) {
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); }
        catch (e) { /* ei kriittistä */ }
    }

    const ilmansuunta = (kulma) =>
        ILMANSUUNNAT[Math.round(kulma / 45) % 8];

    // ---------- Muutoshistoria ----------

    const historiaCache = new Map();   // laitetunnus -> [{aika, arvo, rivit}]
    let historiaRakenneLokitettu = false;

    // Vastauksen muotoa ei ole dokumentoitu: hyväksytään taulukko, kääritty
    // taulukko tai GeoJSON-piirrekokoelma.
    function poimiHistoriarivit(json) {
        if (Array.isArray(json)) return json;
        if (!json || typeof json !== 'object') return [];
        if (Array.isArray(json.features)) return json.features;
        for (const arvo of Object.values(json)) {
            if (Array.isArray(arvo)) return arvo;
        }
        return [];
    }

    // Historiarivin kenttä on 'rows'; 'textRows' hyväksytään varalta.
    function jasennaHistoria(alkio) {
        const p = (alkio && alkio.properties) ? alkio.properties : (alkio || {});
        const aika = p.effectDate ? Date.parse(p.effectDate)
            : (p.date ? Date.parse(p.date) : NaN);
        const arvo = (p.displayValue === null || p.displayValue === undefined)
            ? '' : String(p.displayValue).trim();
        const lahde = Array.isArray(p.rows) ? p.rows
            : (Array.isArray(p.textRows) ? p.textRows : []);
        const rivit = jarjestaRivit(lahde).map(riviTeksti).filter(t => !riviTyhja(t));
        return { aika, arvo, rivit, syy: p.cause || '' };
    }

    const historiaAvain = (r) => r.arvo || r.rivit.join(' / ') || 'pimeänä';

    // Yhdistää peräkkäiset samanarvoiset rivit ja laskee kunkin tilan keston.
    function kokoaHistoria(rivit) {
        const ulos = [];
        for (const r of rivit) {
            const ed = ulos[ulos.length - 1];
            if (ed && historiaAvain(ed) === historiaAvain(r)) {
                ed.alku = r.aika;
                ed.syy = ed.syy || r.syy;
                continue;
            }
            ulos.push(Object.assign({}, r, { alku: r.aika }));
        }
        for (let i = 0; i < ulos.length; i++) {
            ulos[i].loppu = i > 0 ? ulos[i - 1].alku : null; // null = yhä voimassa
            ulos[i].kesto = (ulos[i].loppu == null ? Date.now() : ulos[i].loppu) - ulos[i].alku;
        }
        return ulos;
    }

    // Karsii ohimenevät tilat ja kokoaa uudelleen, kunnes lista ei enää muutu.
    function tiivistaHistoria(rivit, karsi) {
        let tulos = kokoaHistoria(rivit);
        let poistettu = 0;
        if (!karsi) return { rivit: tulos, poistettu: 0 };
        for (let kierros = 0; kierros < 4; kierros++) {
            const suodatettu = tulos.filter(k => k.loppu == null || k.kesto >= OHIMENEVA_MS);
            if (suodatettu.length === tulos.length) break;
            poistettu += tulos.length - suodatettu.length;
            tulos = kokoaHistoria(suodatettu.map(k => Object.assign({}, k, { aika: k.alku })));
        }
        return { rivit: tulos, poistettu };
    }

    function muotoileKesto(ms) {
        const h = ms / 3600000;
        if (h < 1) return Math.round(ms / 60000) + ' min';
        if (h < 48) return h.toFixed(1).replace('.', ',') + ' h';
        return Math.round(h / 24) + ' vrk';
    }

    async function haeHistoria(laitetunnus) {
        if (historiaCache.has(laitetunnus)) return historiaCache.get(laitetunnus);

        const url = `${HISTORIA_API}?deviceId=${encodeURIComponent(laitetunnus)}`;
        const r = await gmGet(url);
        const json = JSON.parse(r.responseText);
        const raakarivit = poimiHistoriarivit(json);

        if (!raakarivit.length && !historiaRakenneLokitettu) {
            historiaRakenneLokitettu = true;
            loki('Historiavastauksen rakennetta ei tunnistettu:', json);
        }

        const rivit = raakarivit
            .map(jasennaHistoria)
            .filter(x => Number.isFinite(x.aika))
            .sort((a, b) => b.aika - a.aika);

        historiaCache.set(laitetunnus, rivit);
        return rivit;
    }

    // ---------- Aika ----------

    // === YHTEINEN: aikaleiman muotoilu ===
    function muotoileIka(ms) {
        if (!Number.isFinite(ms)) return 'Aikaleima puuttuu';
        const d = new Date(ms);
        const nyt = new Date();
        const kello = d.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
        const erotus = nyt - d;
        const vrk = Math.round((new Date(nyt.toDateString()) - new Date(d.toDateString())) / 86400000);

        if (erotus < 15 * 60 * 1000) return 'juuri nyt';
        if (erotus < 60 * 60 * 1000) return `${Math.round(erotus / 60000)} min sitten`;
        if (vrk === 0) return `tänään klo ${kello}`;
        if (vrk === 1) return `eilen klo ${kello}`;
        if (vrk <= 6) {
            const pv = d.toLocaleDateString('fi-FI', { weekday: 'long' });
            return `${pv}na klo ${kello}`;
        }
        if (d.getFullYear() === nyt.getFullYear()) {
            return `${d.getDate()}.${d.getMonth() + 1}. klo ${kello}`;
        }
        return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
    }
    // === /YHTEINEN ===

    // ---------- Piirto ----------

    function piirra() {
        if (!sdk) return;
        sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_NOPEUS });
        sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_VAROITUS });
        if (sdk.Map.getZoomLevel() < MIN_ZOOM || !opasteet.length) return;

        const [minLon, minLat, maxLon, maxLat] = sdk.Map.getMapExtent();
        const nopeus = [];
        const varoitus = [];

        for (const o of opasteet) {
            if (o.lon < minLon || o.lon > maxLon || o.lat < minLat || o.lat > maxLat) continue;
            const kohde = o.nopeus ? nopeus : varoitus;
            if (kohde.length >= MAX_MERKKEJA) continue;
            kohde.push({
                id: o.id,
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [o.lon, o.lat] },
                properties: { ikoni: ikoniAvain(o) }
            });
        }

        if (nopeusNakyy && nopeus.length) {
            sdk.Map.addFeaturesToLayer({ layerName: LAYER_NOPEUS, features: nopeus });
        }
        if (varoitusNakyy && varoitus.length) {
            sdk.Map.addFeaturesToLayer({ layerName: LAYER_VAROITUS, features: varoitus });
        }
    }

    // ---------- Suuntasektori kartalla ----------

    let avoinSuunta = null; // { o, kulma }

    function poistaSektori() {
        if (sdk) sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_SUUNTA });
    }

    function sektorinSade() {
        try {
            const [minLon, , maxLon] = sdk.Map.getMapExtent();
            const el = sdk.Map.getMapViewportElement();
            const leveysPx = (el && el.clientWidth) || window.innerWidth;
            return SEKTORI_PIKSELIT * ((maxLon - minLon) / leveysPx);
        } catch (e) {
            return 0.002;
        }
    }

    function sektoriPolygoni(lon, lat, kulma, sadeDeg) {
        const latKerroin = Math.cos(lat * Math.PI / 180);
        const piste = (a) => {
            const rad = a * Math.PI / 180;
            return [lon + sadeDeg * Math.sin(rad), lat + sadeDeg * Math.cos(rad) * latKerroin];
        };
        const rengas = [[lon, lat]];
        for (let a = kulma - SEKTORI_PUOLIKULMA; a <= kulma + SEKTORI_PUOLIKULMA; a += 4) {
            rengas.push(piste(a));
        }
        rengas.push(piste(kulma + SEKTORI_PUOLIKULMA));
        rengas.push([lon, lat]);
        return { type: 'Polygon', coordinates: [rengas] };
    }

    function piirraSektori() {
        poistaSektori();
        if (!avoinSuunta || avoinOpaste !== avoinSuunta.o) return;
        if (sdk.Map.getZoomLevel() < MIN_ZOOM) return;
        const { o, kulma } = avoinSuunta;
        sdk.Map.addFeaturesToLayer({
            layerName: LAYER_SUUNTA,
            features: [{
                id: o.id + '_suunta',
                type: 'Feature',
                geometry: sektoriPolygoni(o.lon, o.lat, kulma, sektorinSade()),
                properties: { kulma: Math.round(kulma) }
            }]
        });
    }

    // ---------- Paneeli ----------

    function onKlikkaus({ featureId, layerName }) {
        if (layerName !== LAYER_NOPEUS && layerName !== LAYER_VAROITUS) return;
        const o = opasteet.find(x => x.id === featureId);
        if (o) naytaPaneeli(o);
    }

    function tieosoiteTeksti(raaka) {
        if (!raaka) return '';
        const osat = String(raaka).trim().split(/\s+/);
        if (osat.length === 3 && osat.every(x => /^\d+$/.test(x))) {
            return `Tieosoite ${osat.join('/')}`;
        }
        return 'Tieosoite ' + raaka;
    }

    // Varoitustekstien [tie_3] ja [ramppi_12] renderöidään SVG-kuvina.
    function tekstiRivi(teksti) {
        const rivi = document.createElement('div');
        rivi.className = 'op-rivi';
        const osat = String(teksti).split(/(\[[^\]]+\])/);
        for (const osa of osat) {
            if (!osa) continue;
            const m = osa.match(/^\[(tie|ramppi)_(\d+)\]$/i);
            if (m) {
                const kuva = document.createElement('img');
                kuva.className = 'op-symboli';
                kuva.alt = osa;
                kuva.src = KUVA_API + m[1].toLowerCase() + '_' + m[2];
                rivi.appendChild(kuva);
            } else {
                rivi.appendChild(document.createTextNode(osa));
            }
        }
        return rivi;
    }

    function suljePaneeli() {
        avoinOpaste = null;
        avoinSuunta = null;
        poistaSektori();
        const el = document.getElementById('wme-opasteet-panel');
        if (el) el.remove();
    }

    function naytaPaneeli(o) {
        suljePaneeli();
        avoinOpaste = o;

        const panel = document.createElement('div');
        panel.id = 'wme-opasteet-panel';
        panel.style.width = nykyinenLeveys() + 'px';

        const head = document.createElement('div');
        head.className = 'kk-head' + (o.luotettava ? '' : ' kk-vika');
        const otsikko = document.createElement('span');
        otsikko.className = 'kk-otsikko';
        otsikko.textContent = o.nopeus ? 'Vaihtuva nopeusrajoitus' : 'Vaihtuva varoitusopaste';
        otsikko.title = o.id;
        head.append(
            otsikko,
            nappi('−', 'Pienennä ikkunaa', () => { asetaLeveys(nykyinenLeveys() * 0.85, true); sijoitaPaneeli(); }),
            nappi('+', 'Suurenna ikkunaa', () => { asetaLeveys(nykyinenLeveys() * 1.18, true); sijoitaPaneeli(); }),
            nappi('⌖', 'Palauta koko ja sijainti', () => {
                ui.leveys = null; ui.left = null; ui.top = null;
                tallennaUi();
                asetaLeveys(oletusLeveys());
                sijoitaPaneeli();
            }),
            nappi('×', 'Sulje', suljePaneeli)
        );
        panel.appendChild(head);

        if (!o.luotettava) {
            const varoitus = document.createElement('div');
            varoitus.className = 'kk-varoitus';
            varoitus.textContent = 'Opasteen tila ei ole luotettava'
                + (o.reliability ? ` (${o.reliability})` : '') + '.';
            panel.appendChild(varoitus);
        }

        const sisalto = document.createElement('div');
        sisalto.className = 'op-sisalto';

        const nayttö = document.createElement('div');
        nayttö.className = 'op-naytto';
        if (onPimea(o)) {
            const tyhja = document.createElement('div');
            tyhja.className = 'op-tyhja';
            tyhja.textContent = 'Opaste on pimeänä';
            nayttö.appendChild(tyhja);
        } else if (o.nopeus) {
            const merkki = document.createElement('div');
            merkki.className = 'op-merkki';
            merkki.textContent = o.arvo;
            nayttö.appendChild(merkki);
        } else {
            o.rivit.forEach(r => nayttö.appendChild(tekstiRivi(r)));
        }
        sisalto.appendChild(nayttö);

        const tiedot = document.createElement('dl');
        tiedot.className = 'op-tiedot';
        const rivi = (avain, arvo) => {
            if (!arvo) return;
            const dt = document.createElement('dt');
            dt.textContent = avain;
            const dd = document.createElement('dd');
            dd.textContent = arvo;
            tiedot.append(dt, dd);
        };
        if (o.lampotila) rivi('Sisältö', 'Vain lämpötilatietoa');
        rivi('Muuttunut', muotoileIka(o.voimaan));
        if (!o.nopeus && o.arvo) rivi('displayValue', o.arvo);

        // Ajosuunta selkokielisenä; tarkka arvo haetaan taustalla.
        const suuntaDt = document.createElement('dt');
        suuntaDt.textContent = 'Ajosuunta';
        const suuntaDd = document.createElement('dd');
        suuntaDd.textContent = 'Päätellään…';
        tiedot.append(suuntaDt, suuntaDd);

        rivi('Sijainti', tieosoiteTeksti(o.tieosoite));
        rivi('Tierekisterissä', [SUUNNAT[o.suunta] || o.suunta,
            AJORADAT[o.ajorata] || o.ajorata].filter(Boolean).join(', '));
        rivi('Laitetunnus', o.id);
        sisalto.appendChild(tiedot);
        panel.appendChild(sisalto);

        const historia = document.createElement('div');
        historia.className = 'op-historia';
        const avaa = document.createElement('button');
        avaa.type = 'button';
        avaa.className = 'op-historia-nappi';
        avaa.textContent = `Näytä ${HISTORIA_MAARA} viimeisintä muutosta`;
        const lista = document.createElement('div');
        lista.className = 'op-historia-lista';
        historia.append(avaa, lista);

        let haetut = null;      // jäsennetyt raakarivit
        let karsiOhimenevat = true;

        const piirraLista = () => {
            lista.textContent = '';
            if (!haetut || !haetut.length) {
                lista.textContent = 'Muutoshistoriaa ei ole saatavilla.';
                return;
            }
            const { rivit, poistettu } = tiivistaHistoria(haetut, karsiOhimenevat);

            for (const h of rivit.slice(0, HISTORIA_MAARA)) {
                const rivi = document.createElement('div');
                rivi.className = 'op-historia-rivi';

                const arvo = document.createElement('span');
                arvo.className = 'op-historia-arvo';
                arvo.textContent = h.arvo
                    ? (o.nopeus ? h.arvo + ' km/h' : h.arvo)
                    : (h.rivit.length ? h.rivit.join(' / ') : 'pimeänä');
                if (!h.arvo && !h.rivit.length) arvo.classList.add('op-epavarma');

                const aika = document.createElement('span');
                aika.className = 'op-historia-aika';
                aika.textContent = h.loppu == null
                    ? `${muotoileIka(h.alku)} · voimassa`
                    : `${muotoileIka(h.alku)} · ${muotoileKesto(h.kesto)}`;
                aika.title = new Date(h.alku).toLocaleString('fi-FI')
                    + (h.syy ? '\n' + h.syy : '');

                rivi.append(arvo, aika);
                lista.appendChild(rivi);
            }

            const alaosa = document.createElement('div');
            alaosa.className = 'op-historia-alaosa';
            const vaihda = document.createElement('span');
            vaihda.className = 'op-historia-linkki';
            vaihda.textContent = karsiOhimenevat
                ? 'Näytä myös hetkelliset muutokset'
                : 'Piilota hetkelliset muutokset';
            vaihda.onclick = () => { karsiOhimenevat = !karsiOhimenevat; piirraLista(); sijoitaPaneeli(); };
            alaosa.appendChild(vaihda);
            if (karsiOhimenevat && poistettu) {
                const info = document.createElement('span');
                info.textContent = `${poistettu} ohimenevää ohitettu`;
                alaosa.appendChild(info);
            }
            lista.appendChild(alaosa);
        };

        let haettu = false;
        avaa.addEventListener('click', async () => {
            if (haettu) {
                lista.classList.toggle('nakyy');
                avaa.textContent = lista.classList.contains('nakyy')
                    ? 'Piilota muutoshistoria'
                    : `Näytä ${HISTORIA_MAARA} viimeisintä muutosta`;
                sijoitaPaneeli();
                return;
            }
            avaa.disabled = true;
            avaa.textContent = 'Haetaan…';
            try {
                haetut = await haeHistoria(o.id);
                haettu = true;
                piirraLista();
                lista.classList.add('nakyy');
                avaa.textContent = 'Piilota muutoshistoria';
            } catch (err) {
                console.warn(`${SCRIPT_NAME}: historian haku epäonnistui`, err);
                lista.textContent = 'Muutoshistorian haku epäonnistui.';
                lista.classList.add('nakyy');
                avaa.textContent = `Näytä ${HISTORIA_MAARA} viimeisintä muutosta`;
            } finally {
                avaa.disabled = false;
                sijoitaPaneeli();
            }
        });
        sisalto.appendChild(historia);

        const foot = document.createElement('div');
        foot.className = 'kk-foot';
        const linkki = document.createElement('a');
        linkki.href = `${API}/${encodeURIComponent(o.id)}`;
        linkki.target = '_blank';
        linkki.rel = 'noopener';
        linkki.textContent = 'Avaa rajapinnassa';
        const lahde = document.createElement('span');
        lahde.textContent = 'Fintraffic / Digitraffic';
        foot.append(linkki, lahde);
        panel.appendChild(foot);

        const kahva = document.createElement('div');
        kahva.className = 'kk-kahva';
        kahva.title = 'Muuta ikkunan kokoa';
        panel.appendChild(kahva);

        document.body.appendChild(panel);
        teeRaahattavaksi(panel, head);
        teeKoonMuutos(panel, kahva);
        sijoitaPaneeli();

        // Ajosuunnan päättely: yksi WFS-kysely, tulos välimuistiin 30 vrk.
        (async () => {
            if (o.suunta !== 'INCREASING' && o.suunta !== 'DECREASING') {
                suuntaDd.textContent = 'Ei tiedossa';
                return;
            }
            let kulma;
            try {
                kulma = await haeAjosuunta(o);
            } catch (err) {
                kulma = null;
            }
            if (avoinOpaste !== o) return;
            if (kulma === null) {
                suuntaDd.textContent = 'Ei saatu päätellyksi';
                suuntaDd.title = 'Tieosoiteverkosta ei löytynyt tien geometriaa opasteen kohdalta.';
                return;
            }
            suuntaDd.textContent = `Liikenne ajaa ${ilmansuunta(kulma)} (${Math.round(kulma)}°)`;
            avoinSuunta = { o, kulma };
            piirraSektori();
        })();
    }

    // === YHTEINEN: paneelin painike ===
    function nappi(merkki, otsikko, toiminto) {
        const b = document.createElement('div');
        b.className = 'kk-btn';
        b.textContent = merkki;
        b.title = otsikko;
        b.addEventListener('pointerdown', e => e.stopPropagation());
        b.addEventListener('click', e => { e.stopPropagation(); toiminto(); });
        return b;
    }
    // === /YHTEINEN ===

    // === YHTEINEN: paneelin koko ===
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
        const panel = document.getElementById('wme-opasteet-panel');
        if (panel) panel.style.width = w + 'px';
        if (tallenna) tallennaUi();
        return w;
    }
    // === /YHTEINEN ===

    // === YHTEINEN: paneelin sijainti ===
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
        const panel = document.getElementById('wme-opasteet-panel');
        if (!panel) return;

        if (ui.left !== null && ui.top !== null) {
            const r = rajaa(panel, ui.left, ui.top);
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            return;
        }
        if (!avoinOpaste) return;

        const p = karttaPikselit(avoinOpaste.lon, avoinOpaste.lat);
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
    // === /YHTEINEN ===

    // === YHTEINEN: raahaus ===
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
    // === /YHTEINEN ===

    // === YHTEINEN: koon muutos ===
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
    // === /YHTEINEN ===

    function lisaaTyylit() {
        if (document.getElementById('wme-opasteet-css')) return;
        const style = document.createElement('style');
        style.id = 'wme-opasteet-css';
        style.textContent = `
#wme-opasteet-panel{position:fixed;z-index:1000;background:#fff;border:1px solid #c8c8c8;
 border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.3);font-family:"Rubik",Arial,sans-serif;
 font-size:12px;overflow:hidden;user-select:none}
#wme-opasteet-panel.kk-raahaa{opacity:.92}
#wme-opasteet-panel .kk-head{display:flex;align-items:center;gap:6px;padding:8px 10px;
 background:#0b6ec9;color:#fff;font-weight:600;cursor:move;touch-action:none}
#wme-opasteet-panel .kk-head.kk-vika{background:#6b7480}
#wme-opasteet-panel .kk-otsikko{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wme-opasteet-panel .kk-btn{cursor:pointer;font-size:13px;line-height:1;padding:2px 6px;
 border-radius:4px;opacity:.85}
#wme-opasteet-panel .kk-btn:hover{background:rgba(255,255,255,.2);opacity:1}
#wme-opasteet-panel .kk-varoitus{padding:5px 10px;background:#fdf3d8;color:#7a5c00;font-size:11px}
#wme-opasteet-panel .op-sisalto{padding:10px}
#wme-opasteet-panel .op-naytto{background:#1b1d20;color:#f5c518;border-radius:6px;
 padding:12px;text-align:center;margin-bottom:10px;font-family:Arial,Helvetica,sans-serif}
#wme-opasteet-panel .op-merkki{display:inline-flex;align-items:center;justify-content:center;
 width:66px;height:66px;border-radius:50%;background:#fff;color:#111;
 border:7px solid #d0021b;font-size:24px;font-weight:bold}
#wme-opasteet-panel .op-rivi{font-size:14px;line-height:1.5;letter-spacing:.5px}
#wme-opasteet-panel .op-symboli{height:18px;vertical-align:-3px;margin:0 2px}
#wme-opasteet-panel .op-tyhja{color:#8e979f;font-style:italic}
#wme-opasteet-panel .op-tiedot{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:0}
#wme-opasteet-panel .op-tiedot dt{color:#888}
#wme-opasteet-panel .op-tiedot dd{margin:0;color:#333}
#wme-opasteet-panel .op-historia{margin-top:10px;border-top:1px solid #e0e3e7;padding-top:8px}
#wme-opasteet-panel .op-historia-nappi{border:1px solid #c8c8c8;background:#fff;color:#0b6ec9;
 border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit}
#wme-opasteet-panel .op-historia-nappi:hover{background:#e8f1fb}
#wme-opasteet-panel .op-historia-nappi:disabled{opacity:.6;cursor:default}
#wme-opasteet-panel .op-historia-lista{display:none;margin-top:6px}
#wme-opasteet-panel .op-historia-lista.nakyy{display:block}
#wme-opasteet-panel .op-historia-rivi{display:flex;justify-content:space-between;gap:10px;
 padding:3px 0;border-bottom:1px solid #f0f2f4}
#wme-opasteet-panel .op-historia-aika{color:#888}
#wme-opasteet-panel .op-historia-arvo{font-weight:600;color:#333;text-align:right}
#wme-opasteet-panel .op-epavarma{color:#8e979f;font-weight:normal}
#wme-opasteet-panel .op-historia-alaosa{display:flex;justify-content:space-between;gap:10px;
 margin-top:6px;color:#999;font-size:11px}
#wme-opasteet-panel .op-historia-linkki{color:#0b6ec9;cursor:pointer}
#wme-opasteet-panel .op-historia-linkki:hover{text-decoration:underline}
#wme-opasteet-panel .kk-foot{padding:6px 10px;display:flex;justify-content:space-between;
 align-items:center;color:#666;font-size:11px;gap:8px;user-select:text;background:#f8f9fb}
#wme-opasteet-panel .kk-foot a{color:#0b6ec9;white-space:nowrap}
#wme-opasteet-panel .kk-kahva{position:absolute;right:0;bottom:0;width:18px;height:18px;
 cursor:nwse-resize;touch-action:none;
 background:linear-gradient(135deg,transparent 50%,#b0b6bd 50%,#b0b6bd 60%,transparent 60%,
 transparent 72%,#b0b6bd 72%,#b0b6bd 82%,transparent 82%)}
`;
        document.head.appendChild(style);
    }
})();
