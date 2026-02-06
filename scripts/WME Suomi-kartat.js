// ==UserScript==
// @name         WME Suomi-kartat
// @namespace    https://waze.com
// @version      0.3.5
// @description  Googlen kartat + Paikkatietoikkuna + Fintraffic + MML + Vanhat kartat + Väylä
// @author       Stemmi
// @match        https://*.waze.com/*editor*
// @require      https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // Debug flag - set to false to disable console logging in production
    const DEBUG = false;

    // Conversion function from WGS84 to ETRS-TM35FIN (EPSG:3067)
    function wgs84ToETRSTM35FIN(lat, lon) {
        const latRad = lat * Math.PI / 180;
        const lonRad = lon * Math.PI / 180;

        // ETRS-TM35FIN parameters (UTM Zone 35N)
        const lon0 = 27 * Math.PI / 180; // Central meridian 27°E
        const k0 = 0.9996; // Scale factor
        const a = 6378137; // Semi-major axis (GRS80/WGS84)
        const e2 = 0.00669438002290; // First eccentricity squared
        const e4 = e2 * e2;
        const e6 = e4 * e2;

        // Calculate N (radius of curvature in prime vertical)
        const sinLat = Math.sin(latRad);
        const cosLat = Math.cos(latRad);
        const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);

        // Calculate T, C, A
        const T = Math.tan(latRad) * Math.tan(latRad);
        const C = e2 * cosLat * cosLat / (1 - e2);
        const A = cosLat * (lonRad - lon0);

        // Calculate M (meridional arc)
        const M = a * (
            (1 - e2/4 - 3*e4/64 - 5*e6/256) * latRad -
            (3*e2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*latRad) +
            (15*e4/256 + 45*e6/1024) * Math.sin(4*latRad) -
            (35*e6/3072) * Math.sin(6*latRad)
        );

        // Calculate UTM coordinates (ETRS-TM35FIN global grid)
        const x = 500000 + k0 * N * (
            A +
            (1 - T + C) * Math.pow(A,3) / 6 +
            (5 - 18*T + T*T + 72*C - 58*e2) * Math.pow(A,5) / 120
        );
        const y = k0 * (
            M +
            N * Math.tan(latRad) * (
                Math.pow(A,2) / 2 +
                (5 - T + 9*C + 4*C*C) * Math.pow(A,4) / 24 +
                (61 - 58*T + T*T + 600*C - 330*e2) * Math.pow(A,6) / 720
            )
        );

        return {
            x: Math.round(x * 10) / 10, // Rounded to 0.1m
            y: Math.round(y * 10) / 10
        };
    }

    // WME to Paikkatietoikkuna/Maanmittauslaitos zoom level conversion
    function convertZoomLevel(wmeZoom) {
        // Based on examples: WME 6 = Paikka 1, WME 8 = Paikka 3, WME 14 = Paikka 9, WME 18 = Paikka 13
        // Linear relationship: Paikka = WME - 5
        const paikkaZoom = wmeZoom - 5;
        // Ensure zoom is within valid range (typically 1-13)
        return Math.max(1, Math.min(13, paikkaZoom));
    }

    // Function to get Fintraffic coordinates
    function getFintrafficCoordsFromWME() {
        const center = W.map.getCenter();
        // WME uses EPSG:3857 (Web Mercator), same as Fintraffic - use projected coords directly
        const fintrafficX = center.lon;
        const fintrafficY = center.lat;

        return {
            x: fintrafficX.toFixed(6),
            y: fintrafficY.toFixed(6)
        };
    }

    let sliderContainer, isSliderVisible = false;
    let wazeLiveLayer, trafficLayerRef;

    function initOverlay() {
        if (typeof W === 'undefined' || typeof W.map === 'undefined') {
            setTimeout(initOverlay, 1000);
            return;
        }

        const map = W.map;

        const googleBaseLayer = new OpenLayers.Layer.XYZ(
            "Google Maps (Base)",
            "https://mt1.google.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}",
            { isBaseLayer: false, opacity: 0.00, visibility: true }
        );
        const osmLayer = new OpenLayers.Layer.XYZ(
            "OpenStreetMap",
            "https://tile.openstreetmap.org/${z}/${x}/${y}.png",
            {
                isBaseLayer: false,
                opacity: 0.00,
                visibility: true,
                attribution: "© OpenStreetMap contributors"
            }
        );
        wazeLiveLayer = new OpenLayers.Layer.XYZ(
            "Waze Live Map",
            "https://worldtiles1.waze.com/tiles/${z}/${x}/${y}.png",
            { isBaseLayer: false, opacity: 0.00, visibility: true }
        );

        map.addLayer(wazeLiveLayer);
        map.addLayer(googleBaseLayer);
        map.addLayer(osmLayer);

        sliderContainer = document.createElement("div");
        sliderContainer.style.position = "absolute";
        sliderContainer.style.top = "64px";
        sliderContainer.style.left = "50%";
        sliderContainer.style.transform = "translateX(-50%)";
        sliderContainer.style.zIndex = "1000";
        sliderContainer.style.padding = "8px";
        sliderContainer.style.background = "rgba(20, 25, 50, 0.95)";
        sliderContainer.style.borderRadius = "10px";
        sliderContainer.style.border = "1px solid white";
        sliderContainer.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
        sliderContainer.style.display = "none";
        sliderContainer.style.flexDirection = "row";
        sliderContainer.style.gap = "10px";
        sliderContainer.style.fontFamily = "sans-serif";
        sliderContainer.style.transition = "all 0.3s ease";

        const layers = [
            {
                name: "Waze Live",
                icon: "https://cdn-images-1.medium.com/max/1200/1*3kS1iOOTBrvtkecae3u2aA.png",
                initial: 0.00,
                onChange: value => wazeLiveLayer.setOpacity(value)
            },
            {
                name: "Google Maps",
                icon: "https://static.vecteezy.com/system/resources/previews/016/716/478/non_2x/google-maps-icon-free-png.png",
                initial: 0.00,
                onChange: value => googleBaseLayer.setOpacity(value)
            },
            {
                name: "Traffic",
                icon: "https://i.ibb.co/rK09xy0d/traffic-layer.jpg",
                initial: 0.00,
                onChange: value => {
                    if (trafficLayerRef) trafficLayerRef.setOpacity(value);
                }
            },
            {
                name: "Paikkatietoikkuna",
                icon: "https://kartta.paikkatietoikkuna.fi/static/img/ikkuna.svg",
                initial: 0.00,
                isButton: true
            },
            {
                name: "Fintraffic",
                icon: "https://www.fintraffic.fi/themes/custom/traffic/images/favicons/favicon.ico",
                initial: 0.00,
                isButton: true
            },
            {
                name: "Maanmittauslaitos",
                icon: "https://asiointi.maanmittauslaitos.fi/styles/img/favicon.ico",
                initial: 0.00,
                isButton: true
            },
            {
                name: "Vanhat kartat",
                icon: "https://vanhatkartat.fi/_nuxt/img/vanhatkartat-logo.e4053bf.svg",
                initial: 0.00,
                isButton: true
            },
            {
                name: "Väylä",
                icon: "https://vaylafi.kuvat.fi/kuvat/V%C3%A4yl%C3%A4viraston%20logo/RGB%20%28digi%29/JPG/vayla_v_rgb.jpg?img=full",
                initial: 0.00,
                isButton: true
            }
        ];

        layers.forEach(layer => {
            const wrapper = document.createElement("div");
            wrapper.style.width = "40px";
            wrapper.style.textAlign = "center";

            const img = document.createElement("img");
            img.src = layer.icon;
            img.alt = layer.name;
            img.title = layer.name;
            img.style.width = "40px";
            img.style.height = "40px";
            img.style.borderRadius = "12px";
            img.style.border = "2px solid white";
            img.style.transition = "transform 0.3s ease, border 0.3s ease";
            img.style.display = "block";
            img.style.marginBottom = "4px";
            img.style.cursor = "pointer";

            img.addEventListener("mouseenter", () => {
                img.style.transform = "scale(1.1)";
                img.style.border = "2px solid gold";
            });

            img.addEventListener("mouseleave", () => {
                img.style.transform = "scale(1)";
                img.style.border = "2px solid white";
            });

            img.addEventListener("click", () => {
                const center = W.map.getCenter();
                const zoom = W.map.getZoom();
                const lonlat = new OpenLayers.LonLat(center.lon, center.lat);
                lonlat.transform(
                    new OpenLayers.Projection("EPSG:900913"),
                    new OpenLayers.Projection("EPSG:4326")
                );
                const lat = parseFloat(lonlat.lat.toFixed(6));
                const lon = parseFloat(lonlat.lon.toFixed(6));

                if (layer.name === "Google Maps")
                    window.open(`https://www.google.com/maps/@${lat},${lon},${zoom}z`, '_blank');
                if (layer.name === "Waze Live")
                    window.open(`https://www.waze.com/live-map/?lat=${lat}&lon=${lon}&zoom=${zoom}`, '_blank');
                if (layer.name === "Paikkatietoikkuna") {
                    const coords = wgs84ToETRSTM35FIN(lat, lon);
                    const paikkaZoom = convertZoomLevel(zoom);
                    if (DEBUG) console.log(`Paikkatietoikkuna: WGS84(${lat}, ${lon}) -> ETRS-TM35FIN(${coords.x}, ${coords.y}), WME zoom ${zoom} -> Paikka zoom ${paikkaZoom}`);
                    window.open(`https://kartta.paikkatietoikkuna.fi/?zoomLevel=${paikkaZoom}&coord=${coords.x}_${coords.y}&showIntro=false`, '_blank');
                }
                if (layer.name === "Fintraffic") {
                    const coords = getFintrafficCoordsFromWME();
                    if (DEBUG) console.log(`Fintraffic coordinates: x=${coords.x}, y=${coords.y}`);
                    window.open(`https://liikennetilanne.fintraffic.fi/kartta/?lang=fi&x=${coords.x}&y=${coords.y}&z=${zoom}&checkedLayers=1&basemap=pedestrian-vector`, '_blank');
                }
                if (layer.name === "Maanmittauslaitos") {
                    const coords = wgs84ToETRSTM35FIN(lat, lon);
                    const mmlZoom = convertZoomLevel(zoom);
                    if (DEBUG) console.log(`Maanmittauslaitos: WGS84(${lat}, ${lon}) -> ETRS-TM35FIN(${coords.x}, ${coords.y}), WME zoom ${zoom} -> MML zoom ${mmlZoom}`);
                    window.open(`https://asiointi.maanmittauslaitos.fi/karttapaikka/?lang=fi&n=${coords.y}&e=${coords.x}&zoom=${mmlZoom}`, '_blank');
                }
                if (layer.name === "Vanhat kartat") {
                    if (DEBUG) console.log(`Vanhat kartat: lat=${lat}, lon=${lon}, zoom=${zoom}`);
                    window.open(`https://vanhatkartat.fi/#${zoom}/${lat}/${lon}`, '_blank');
                }
                if (layer.name === "Väylä") {
                    const coords = wgs84ToETRSTM35FIN(lat, lon);
                    const vaylaZoom = Math.max(1, Math.min(18, zoom - 6));
                    const layers = "1270+100+digiroad:dr_nopeusrajoitus++1488+100+digiroad:DR_Tielinkin_tyyppi++793+100+default";
                    const url = `https://suomenvaylat.vayla.fi/link/${vaylaZoom}/${Math.round(coords.x)}/${Math.round(coords.y)}/${layers}/?lang=fi`;
                    if (DEBUG) console.log(`Väylä: WGS84(${lat}, ${lon}) -> ETRS-TM35FIN(${coords.x}, ${coords.y}), WME zoom ${zoom} -> Väylä zoom ${vaylaZoom}`);
                    window.open(url, '_blank');
                }
            });

            wrapper.appendChild(img);

            if (!layer.isButton) {
                const slider = document.createElement("input");
                slider.type = "range";
                slider.min = "0";
                slider.max = "1";
                slider.step = "0.01";
                slider.value = layer.initial;
                slider.style.width = "100%";
                slider.addEventListener("input", () => {
                    layer.onChange(parseFloat(slider.value));
                });
                wrapper.appendChild(slider);
            }

            sliderContainer.appendChild(wrapper);
        });

        const toggleButton = document.createElement("button");
        toggleButton.textContent = isSliderVisible ? "Hide" : "Show";
        toggleButton.style.position = "absolute";
        toggleButton.style.top = "32px";
        toggleButton.style.left = "50%";
        toggleButton.style.transform = "translateX(-50%)";
        toggleButton.style.zIndex = "2000";
        toggleButton.style.padding = "5px 10px";
        toggleButton.style.backgroundColor = "rgb(5, 133, 220)";
        toggleButton.style.color = "white";
        toggleButton.style.border = "1px solid white";
        toggleButton.style.borderRadius = "5px";
        toggleButton.style.cursor = "pointer";
        toggleButton.style.transition = "all 0.3s ease";
        toggleButton.addEventListener("click", () => {
            isSliderVisible = !isSliderVisible;
            sliderContainer.style.display = isSliderVisible ? "flex" : "none";
            toggleButton.textContent = isSliderVisible ? "Hide" : "Show";
        });

        document.body.appendChild(toggleButton);
        document.body.appendChild(sliderContainer);

        initTrafficLayer();
    }

    function initTrafficLayer() {
        trafficLayerRef = new OpenLayers.Layer.XYZ(
            "Google Traffic",
            "https://mt1.google.com/vt/lyrs=h@159000000,traffic&hl=en&x=${x}&y=${y}&z=${z}",
            {
                isBaseLayer: false,
                opacity: 0.00,
                visibility: true
            }
        );
        W.map.addLayer(trafficLayerRef);
    }

    setTimeout(initOverlay, 2000);

})();