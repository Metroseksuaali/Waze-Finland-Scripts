// ==UserScript==
// @name         WME Polygon Validator
// @namespace    https://github.com/Metroseksuaali/Waze-Finland-Scripts
// @version      1.1.0
// @description  Real-time warning when a polygon becomes invalid (self-intersecting) in WME
// @author       Metro
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/editor*
// @match        https://beta.waze.com/*/editor*
// @require      https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_ID = 'wme-polygon-validator';
    const SCRIPT_NAME = 'WME Polygon Validator';
    const SCRIPT_VERSION = '1.1.0';

    let wmeSDK = null;
    let warningBanner = null;
    let kinkMarkers = [];
    let mapLayer = null;

    // ============================================
    // Initialization
    // ============================================

    function log(message) {
        console.log(`[${SCRIPT_NAME}] ${message}`);
    }

    function init() {
        if (typeof window.SDK_INITIALIZED !== 'undefined') {
            window.SDK_INITIALIZED.then(initWithSDK);
        } else {
            waitForSDK();
        }
    }

    function waitForSDK() {
        if (typeof window.SDK_INITIALIZED !== 'undefined') {
            window.SDK_INITIALIZED.then(initWithSDK);
        } else if (typeof window.getWmeSdk !== 'undefined') {
            initWithSDK();
        } else {
            setTimeout(waitForSDK, 500);
        }
    }

    function initWithSDK() {
        try {
            if (typeof window.getWmeSdk === 'function') {
                wmeSDK = window.getWmeSdk({
                    scriptId: SCRIPT_ID,
                    scriptName: SCRIPT_NAME
                });
            }
        } catch (e) {
            // SDK initialization failed, continue with fallback
        }

        waitForWME();
    }

    function waitForWME() {
        if (window.W && window.W.map && window.W.model && window.W.selectionManager) {
            setupValidator();
        } else {
            setTimeout(waitForWME, 500);
        }
    }

    // ============================================
    // Validator setup
    // ============================================

    function setupValidator() {
        createMapLayer();
        createWarningBanner();

        // Listen for selection changes
        window.W.selectionManager.events.register('selectionchanged', null, onSelectionChanged);

        // Listen for edit actions
        window.W.model.actionManager.events.register('afteraction', null, onAfterAction);
        window.W.model.actionManager.events.register('afterundoaction', null, onAfterAction);
        window.W.model.actionManager.events.register('afterclearactions', null, clearWarnings);

        log('Initialized');

        // Initial check if something is already selected
        setTimeout(validateGeometry, 500);
    }

    // ============================================
    // Map layer
    // ============================================

    function createMapLayer() {
        if (window.OpenLayers) {
            mapLayer = new window.OpenLayers.Layer.Vector(SCRIPT_NAME, {
                displayInLayerSwitcher: false,
                uniqueName: SCRIPT_ID
            });
            window.W.map.addLayer(mapLayer);
        }
    }

    // ============================================
    // Warning banner
    // ============================================

    function createWarningBanner() {
        warningBanner = document.createElement('div');
        warningBanner.id = 'wme-polygon-validator-warning';
        warningBanner.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #dc3545;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: bold;
            z-index: 10000;
            display: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 90%;
        `;
        warningBanner.innerHTML = `
            <span style="margin-right: 8px;">\u26a0\ufe0f</span>
            <span id="wme-pv-message">Polygon is self-intersecting!</span>
            <span style="margin-left: 12px; font-weight: normal; font-size: 12px;">
                Fix the shape before saving
            </span>
        `;
        document.body.appendChild(warningBanner);
    }

    function showWarning(kinkCount) {
        if (warningBanner) {
            const message = document.getElementById('wme-pv-message');
            if (message) {
                if (kinkCount === 1) {
                    message.textContent = 'Polygon is self-intersecting at 1 point!';
                } else {
                    message.textContent = `Polygon is self-intersecting at ${kinkCount} points!`;
                }
            }
            warningBanner.style.display = 'block';
        }
    }

    function hideWarning() {
        if (warningBanner) {
            warningBanner.style.display = 'none';
        }
    }

    // ============================================
    // Map markers (intersection points)
    // ============================================

    function drawKinkMarkers(kinks) {
        clearKinkMarkers();

        if (!mapLayer || !window.OpenLayers || !kinks || !kinks.features) {
            return;
        }

        kinks.features.forEach(kink => {
            const coords = kink.geometry.coordinates;
            const lonLat = new window.OpenLayers.LonLat(coords[0], coords[1]);
            const projectedLonLat = lonLat.transform(
                new window.OpenLayers.Projection('EPSG:4326'),
                window.W.map.getProjectionObject()
            );

            const point = new window.OpenLayers.Geometry.Point(projectedLonLat.lon, projectedLonLat.lat);
            const style = {
                pointRadius: 12,
                fillColor: '#dc3545',
                fillOpacity: 0.9,
                strokeColor: '#ffffff',
                strokeWidth: 3,
                strokeOpacity: 1
            };

            const feature = new window.OpenLayers.Feature.Vector(point, null, style);
            kinkMarkers.push(feature);
            mapLayer.addFeatures([feature]);
        });
    }

    function clearKinkMarkers() {
        if (mapLayer && kinkMarkers.length > 0) {
            mapLayer.removeFeatures(kinkMarkers);
        }
        kinkMarkers = [];
    }

    function clearWarnings() {
        hideWarning();
        clearKinkMarkers();
    }

    // ============================================
    // Geometry retrieval
    // ============================================

    function getSelectedVenue() {
        let selection;
        if (window.W.selectionManager.getSelectedWMEFeatures) {
            selection = window.W.selectionManager.getSelectedWMEFeatures();
        } else {
            selection = window.W.selectionManager.getSelectedFeatures();
        }

        if (!selection || selection.length === 0) {
            return null;
        }

        const feature = selection[0];
        let venue = null;

        if (feature && feature.model) {
            venue = feature.model;
        } else if (feature && feature.type === 'venue') {
            venue = feature;
        } else if (feature && feature._wmeObject) {
            venue = feature._wmeObject;
        } else if (feature && feature.attributes && feature.attributes.wazeFeature) {
            venue = feature.attributes.wazeFeature._wmeObject || feature.attributes.wazeFeature;
        }

        if (!venue || venue.type !== 'venue') {
            return null;
        }

        return venue;
    }

    function getVenueGeometry(venue) {
        if (!venue) return null;

        if (typeof venue.getGeometry === 'function') {
            return venue.getGeometry();
        } else if (venue.geometry) {
            return venue.geometry;
        } else if (venue.attributes && venue.attributes.geometry) {
            return venue.attributes.geometry;
        }

        return null;
    }

    function isAreaVenue(venue) {
        if (!venue) return false;

        if (typeof venue.isPoint === 'function') {
            return !venue.isPoint();
        }

        if (venue.attributes && venue.attributes.geometry) {
            const geomType = venue.attributes.geometry.type;
            return geomType === 'Polygon' || geomType === 'MultiPolygon';
        }

        const geometry = getVenueGeometry(venue);
        if (geometry && geometry.CLASS_NAME) {
            return geometry.CLASS_NAME.includes('Polygon');
        }

        return true;
    }

    // ============================================
    // Geometry conversion to GeoJSON
    // ============================================

    function wmeGeometryToGeoJSON(geometry) {
        if (!geometry) {
            return null;
        }

        try {
            if (geometry.components && geometry.CLASS_NAME) {
                if (geometry.CLASS_NAME.includes('Polygon')) {
                    const coordinates = [];

                    geometry.components.forEach(ring => {
                        const ringCoords = [];
                        if (ring.components) {
                            ring.components.forEach(point => {
                                const lonLat = new window.OpenLayers.LonLat(point.x, point.y);
                                const wgs84LonLat = lonLat.transform(
                                    window.W.map.getProjectionObject(),
                                    new window.OpenLayers.Projection('EPSG:4326')
                                );
                                ringCoords.push([wgs84LonLat.lon, wgs84LonLat.lat]);
                            });
                        }
                        if (ringCoords.length > 0) {
                            coordinates.push(ringCoords);
                        }
                    });

                    if (coordinates.length > 0 && coordinates[0].length >= 4) {
                        return turf.polygon(coordinates);
                    }
                    return null;
                }
            }

            if (geometry.type === 'Polygon' && geometry.coordinates) {
                return turf.polygon(geometry.coordinates);
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    // ============================================
    // Validation
    // ============================================

    function validateGeometry() {
        const venue = getSelectedVenue();
        if (!venue) {
            clearWarnings();
            return;
        }

        if (!isAreaVenue(venue)) {
            clearWarnings();
            return;
        }

        const geometry = getVenueGeometry(venue);
        if (!geometry) {
            clearWarnings();
            return;
        }

        const geoJSON = wmeGeometryToGeoJSON(geometry);
        if (!geoJSON) {
            clearWarnings();
            return;
        }

        try {
            const kinks = turf.kinks(geoJSON);

            if (kinks && kinks.features && kinks.features.length > 0) {
                showWarning(kinks.features.length);
                drawKinkMarkers(kinks);
            } else {
                clearWarnings();
            }
        } catch (e) {
            clearWarnings();
        }
    }

    // ============================================
    // Event handlers
    // ============================================

    function onSelectionChanged() {
        setTimeout(validateGeometry, 150);
    }

    function onAfterAction() {
        setTimeout(validateGeometry, 100);
    }

    // ============================================
    // Start script
    // ============================================

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

})();
