// ==UserScript==
// @name         WME INSPIRE Maanmittauslaitos
// @namespace    https://waze.com
// @version      1.0.1
// @description  INSPIRE WMS layers from Maanmittauslaitos for Waze Map Editor
// @author       Stemmi
// @match        https://*.waze.com/*editor*
// @grant        GM_xmlhttpRequest
// @connect      inspire-wms.maanmittauslaitos.fi
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    console.log('WME INSPIRE Maanmittauslaitos: Starting...');

    // Global state
    let availableLayers = [];
    let activeLayers = new Map();
    let quickAccessLayers = new Set();
    let floatingButton = null;
    let sidebarPanel = null;

    // INSPIRE WMS Services Configuration
    const INSPIRE_SERVICES = [
        {
            name: 'Administrative Units',
            shortName: 'AU',
            url: 'https://inspire-wms.maanmittauslaitos.fi/inspire-wms/AU/ows',
            description: 'Kunnat (1:1 000 000)'
        },
        {
            name: 'Geographical Names',
            shortName: 'GN',
            url: 'https://inspire-wms.maanmittauslaitos.fi/inspire-wms/GN/ows',
            description: 'Geographical Names'
        },
        {
            name: 'Buildings',
            shortName: 'BU',
            url: 'https://inspire-wms.maanmittauslaitos.fi/inspire-wms/BU_MTK/ows',
            description: 'Rakennukset'
        }
    ];

    // Configuration
    const WMS_CONFIG = {
        version: '1.3.0',
        crs: 'EPSG:3857'
    };

    // LocalStorage keys
    const STORAGE_KEYS = {
        quickAccess: 'wme-inspire-mml-quickaccess',
        activeLayers: 'wme-inspire-mml-active',
        layerOpacity: 'wme-inspire-mml-opacity',
        buttonPosition: 'wme-inspire-mml-position'
    };

    // Helper function to create elements
    function createElem(tag, attrs = {}) {
        const elem = document.createElement(tag);
        Object.entries(attrs).forEach(([key, value]) => {
            if (key === 'style') {
                elem.setAttribute(key, value);
            } else if (key === 'textContent') {
                elem.textContent = value;
            } else if (key === 'innerHTML') {
                elem.innerHTML = value;
            } else {
                elem.setAttribute(key, value);
            }
        });
        return elem;
    }

    // Debounced save preferences to localStorage
    let saveTimeout;
    function savePreferences() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEYS.quickAccess, JSON.stringify(Array.from(quickAccessLayers)));
                localStorage.setItem(STORAGE_KEYS.activeLayers, JSON.stringify(Array.from(activeLayers.keys())));

                const opacities = {};
                availableLayers.forEach(layer => {
                    if (layer.opacity !== 0.8) {
                        opacities[layer.id] = layer.opacity;
                    }
                });
                localStorage.setItem(STORAGE_KEYS.layerOpacity, JSON.stringify(opacities));

                if (floatingButton) {
                    const position = {
                        top: floatingButton.style.top,
                        left: floatingButton.style.left
                    };
                    localStorage.setItem(STORAGE_KEYS.buttonPosition, JSON.stringify(position));
                }

                console.log('WME INSPIRE MML: Preferences saved');
            } catch (error) {
                console.warn('WME INSPIRE MML: Failed to save preferences:', error);
            }
        }, 500);
    }

    // Load preferences from localStorage
    function loadPreferences() {
        try {
            const savedQuickAccess = localStorage.getItem(STORAGE_KEYS.quickAccess);
            if (savedQuickAccess) {
                const quickAccessArray = JSON.parse(savedQuickAccess);
                quickAccessLayers = new Set(quickAccessArray);
                console.log(`WME INSPIRE MML: Loaded ${quickAccessArray.length} quick access layers`);
            }

            const savedOpacities = localStorage.getItem(STORAGE_KEYS.layerOpacity);
            if (savedOpacities) {
                const opacities = JSON.parse(savedOpacities);
                availableLayers.forEach(layer => {
                    if (opacities[layer.id]) {
                        layer.opacity = opacities[layer.id];
                    }
                });
                console.log('WME INSPIRE MML: Loaded layer opacities');
            }

            const savedActiveLayers = localStorage.getItem(STORAGE_KEYS.activeLayers);
            if (savedActiveLayers) {
                const activeLayerIds = JSON.parse(savedActiveLayers);
                console.log(`WME INSPIRE MML: Restoring ${activeLayerIds.length} active layers`);

                setTimeout(() => {
                    activeLayerIds.forEach(layerId => {
                        const layerConfig = availableLayers.find(l => l.id === layerId);
                        if (layerConfig) {
                            toggleLayer(layerConfig, true);
                        }
                    });
                }, 1000);
            }

        } catch (error) {
            console.warn('WME INSPIRE MML: Failed to load preferences:', error);
        }
    }

    // Load button position
    function loadButtonPosition() {
        try {
            const savedPosition = localStorage.getItem(STORAGE_KEYS.buttonPosition);
            if (savedPosition && floatingButton) {
                const position = JSON.parse(savedPosition);
                if (position.top && position.left) {
                    floatingButton.style.top = position.top;
                    floatingButton.style.left = position.left;
                    console.log('WME INSPIRE MML: Restored button position');
                }
            }
        } catch (error) {
            console.warn('WME INSPIRE MML: Failed to load button position:', error);
        }
    }

    // Wait for WME to load
    function init() {
        if (typeof W === 'undefined' || typeof W.map === 'undefined' || typeof OpenLayers === 'undefined') {
            setTimeout(init, 500);
            return;
        }

        console.log('WME INSPIRE MML: WME loaded, fetching capabilities...');
        fetchAllCapabilities();
    }

    // Fetch capabilities from all INSPIRE services
    async function fetchAllCapabilities() {
        try {
            const promises = INSPIRE_SERVICES.map(service => fetchServiceCapabilities(service));
            await Promise.all(promises);

            console.log(`WME INSPIRE MML: Found ${availableLayers.length} total layers from all services`);
            loadPreferences();
            initializeUI();
        } catch (error) {
            console.error('WME INSPIRE MML: Failed to fetch capabilities:', error);
            availableLayers = getDefaultLayers();
            loadPreferences();
            initializeUI();
        }
    }

    // Fetch capabilities for a single service
    function fetchServiceCapabilities(service) {
        return new Promise((resolve, reject) => {
            const capabilitiesUrl = `${service.url}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=${WMS_CONFIG.version}`;

            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: capabilitiesUrl,
                    onload: function (response) {
                        try {
                            parseServiceCapabilities(response.responseText, service);
                            resolve();
                        } catch (error) {
                            console.warn(`Failed to parse capabilities for ${service.name}:`, error);
                            resolve(); // Continue with other services
                        }
                    },
                    onerror: function (error) {
                        console.warn(`Failed to fetch capabilities for ${service.name}:`, error);
                        resolve(); // Continue with other services
                    }
                });
            } else {
                fetch(capabilitiesUrl, { mode: 'cors', credentials: 'omit' })
                    .then(response => response.text())
                    .then(xmlText => {
                        parseServiceCapabilities(xmlText, service);
                        resolve();
                    })
                    .catch(error => {
                        console.warn(`Failed to fetch capabilities for ${service.name}:`, error);
                        resolve(); // Continue with other services
                    });
            }
        });
    }

    // Parse capabilities XML for a service
    function parseServiceCapabilities(xmlText, service) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        // Get all layers with Name elements (both queryable="1" and queryable="0")
        const layers = xmlDoc.querySelectorAll('Layer[queryable]');
        const serviceLayers = Array.from(layers).map(layer => {
            const name = layer.querySelector('Name')?.textContent;
            const title = layer.querySelector('Title')?.textContent;
            const abstract = layer.querySelector('Abstract')?.textContent;

            if (name && title) {
                return {
                    id: `${service.shortName}:${name}`,
                    name: name,
                    title: title,
                    abstract: abstract || '',
                    service: service,
                    visible: false,
                    opacity: 0.8
                };
            }
            return null;
        }).filter(Boolean);

        availableLayers.push(...serviceLayers);
        console.log(`WME INSPIRE MML: Found ${serviceLayers.length} layers from ${service.name}`);
    }

    // Fallback layers if GetCapabilities fails
    function getDefaultLayers() {
        return [
            // Administrative Units service layers
            {
                id: 'AU:AU.AdministrativeUnit',
                name: 'AU.AdministrativeUnit',
                title: 'Administrative Units',
                abstract: 'Kunnat (1:1 000 000)',
                service: INSPIRE_SERVICES[0],
                visible: false,
                opacity: 0.8
            },
            {
                id: 'AU:AU.AdministrativeBoundary',
                name: 'AU.AdministrativeBoundary',
                title: 'Administrative Boundary',
                abstract: 'Hallinnolliset rajat',
                service: INSPIRE_SERVICES[0],
                visible: false,
                opacity: 0.8
            },
            // Geographical Names service layers
            {
                id: 'GN:GN.GeographicalNames',
                name: 'GN.GeographicalNames',
                title: 'Geographical Names',
                abstract: 'Maantieteelliset nimet',
                service: INSPIRE_SERVICES[1],
                visible: false,
                opacity: 0.8
            },
            // Buildings service layers
            {
                id: 'BU:BU.Building',
                name: 'BU.Building',
                title: 'Buildings',
                abstract: 'Rakennukset',
                service: INSPIRE_SERVICES[2],
                visible: false,
                opacity: 0.8
            }
        ];
    }

    // Initialize UI components
    function initializeUI() {
        if (W?.userscripts?.state.isReady) {
            createSidebarPanel();
            createFloatingButton();
        } else {
            document.addEventListener('wme-ready', () => {
                createSidebarPanel();
                createFloatingButton();
            }, { once: true });
        }
    }
    // Create sidebar panel
    async function createSidebarPanel() {
        console.log('WME INSPIRE MML: Creating sidebar panel...');

        const { tabLabel, tabPane } = W.userscripts.registerSidebarTab('INSPIRE-MML');
        tabLabel.textContent = '🗺️';
        tabLabel.title = 'INSPIRE Maanmittauslaitos Layers';

        const divRoot = createElem('div', {
            style: 'padding: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px;'
        });

        // Header
        const header = createElem('h4', {
            style: 'font-weight: bold; margin: 0 0 8px 0; color: #2E7D32; font-size: 14px;',
            textContent: 'INSPIRE Maanmittauslaitos'
        });
        divRoot.appendChild(header);

        const version = createElem('div', {
            style: 'margin: 0 0 8px 0; font-size: 10px; color: #999;',
            textContent: 'Version 1.0.1'
        });
        divRoot.appendChild(version);

        // Search box
        const searchContainer = createElem('div', { style: 'margin-bottom: 8px;' });
        const searchInput = createElem('input', {
            type: 'text',
            placeholder: 'Hae tasoja...',
            style: 'width: 100%; padding: 4px 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 11px;'
        });
        searchContainer.appendChild(searchInput);
        divRoot.appendChild(searchContainer);

        // Layer count info
        const layerInfo = createElem('div', {
            style: 'margin-bottom: 6px; font-size: 10px; color: #666;',
            textContent: `${availableLayers.length} INSPIRE tasoa saatavilla`
        });
        divRoot.appendChild(layerInfo);

        // Active layers section
        const activeLayersHeader = createElem('h5', {
            style: 'margin: 8px 0 4px 0; color: #d32f2f; font-size: 12px;',
            textContent: 'Aktiiviset tasot'
        });
        divRoot.appendChild(activeLayersHeader);

        const activeLayersInfo = createElem('div', {
            style: 'font-size: 10px; color: #666; margin-bottom: 6px;',
            textContent: 'Tällä hetkellä näkyvissä olevat tasot:'
        });
        divRoot.appendChild(activeLayersInfo);

        const activeLayersList = createElem('div', {
            style: 'max-height: 120px; overflow-y: auto; border: 1px solid #d32f2f; border-radius: 3px; padding: 3px; margin-bottom: 8px; background: #fff5f5;'
        });
        divRoot.appendChild(activeLayersList);

        // Layer list container
        const layerList = createElem('div', {
            style: 'max-height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 3px; margin-bottom: 8px;'
        });
        divRoot.appendChild(layerList);

        // Quick access section
        const quickAccessHeader = createElem('h5', {
            style: 'margin: 8px 0 4px 0; color: #2E7D32; font-size: 12px;',
            textContent: 'Pika-aktivointi'
        });
        divRoot.appendChild(quickAccessHeader);

        const quickAccessInfo = createElem('div', {
            style: 'font-size: 10px; color: #666; margin-bottom: 6px;',
            textContent: 'Valitse tasot kelluvaan painikkeeseen:'
        });
        divRoot.appendChild(quickAccessInfo);

        const availableHeight = Math.max(200, window.innerHeight - 650);
        const quickAccessList = createElem('div', {
            style: `max-height: ${availableHeight}px; overflow-y: auto; border: 1px solid #ddd; border-radius: 3px; padding: 3px;`
        });
        divRoot.appendChild(quickAccessList);

        // License info
        const licenseInfo = createElem('div', {
            style: 'margin-top: 8px; padding: 6px; background: #f0f8ff; border: 1px solid #2E7D32; border-radius: 3px; font-size: 9px;',
            innerHTML: '<strong>Lähde:</strong> Maanmittauslaitos INSPIRE-palvelut<br><strong>Lisenssi:</strong> CC BY 4.0'
        });
        divRoot.appendChild(licenseInfo);

        tabPane.appendChild(divRoot);
        tabPane.id = 'sidepanel-inspire-mml';
        await W.userscripts.waitForElementConnected(tabPane);

        sidebarPanel = {
            searchInput,
            layerList,
            quickAccessList,
            activeLayersList,
            layerInfo,
            activeLayersInfo
        };

        setupSidebarEvents();
        renderLayerList();
    }

    // Setup sidebar event listeners
    function setupSidebarEvents() {
        sidebarPanel.searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            renderLayerList(searchTerm);
        });
    }

    // Render layer list with optional search filter
    function renderLayerList(searchTerm = '') {
        const filteredLayers = availableLayers.filter(layer =>
            layer.title.toLowerCase().includes(searchTerm) ||
            layer.name.toLowerCase().includes(searchTerm) ||
            layer.abstract.toLowerCase().includes(searchTerm) ||
            layer.service.name.toLowerCase().includes(searchTerm)
        );

        sidebarPanel.layerInfo.textContent = searchTerm ?
            `${filteredLayers.length} / ${availableLayers.length} INSPIRE tasoa` :
            `${availableLayers.length} INSPIRE tasoa saatavilla`;

        // Clear existing content
        sidebarPanel.layerList.innerHTML = '';
        sidebarPanel.quickAccessList.innerHTML = '';
        sidebarPanel.activeLayersList.innerHTML = '';

        // Render active layers section
        const activeLayersArray = availableLayers.filter(layer => activeLayers.has(layer.id));

        if (activeLayersArray.length === 0) {
            const emptyMsg = createElem('div', {
                style: 'color: #999; font-size: 10px; text-align: center; padding: 8px; font-style: italic;',
                textContent: 'Ei aktiivisia tasoja'
            });
            sidebarPanel.activeLayersList.appendChild(emptyMsg);
        } else {
            activeLayersArray.forEach((layer, index) => {
                const activeItem = createLayerItem(layer, index, false, true);
                sidebarPanel.activeLayersList.appendChild(activeItem);
            });
        }

        sidebarPanel.activeLayersInfo.textContent = activeLayersArray.length === 0 ?
            'Ei aktiivisia tasoja' :
            `${activeLayersArray.length} tasoa aktiivinen${activeLayersArray.length !== 1 ? 'a' : ''}`;

        // Render main layer list
        filteredLayers.forEach((layer, index) => {
            const layerItem = createLayerItem(layer, index, false, false);
            sidebarPanel.layerList.appendChild(layerItem);
        });

        // Render quick access list
        availableLayers.filter(layer => quickAccessLayers.has(layer.id)).forEach((layer, index) => {
            const quickItem = createLayerItem(layer, index, true, false);
            sidebarPanel.quickAccessList.appendChild(quickItem);
        });

        updateFloatingButton(document.getElementById('inspire-mml-floating-panel'));
    }

    // Create individual layer item
    function createLayerItem(layer, index, isQuickAccess, isActiveSection = false) {
        const isActive = activeLayers.has(layer.id);
        const backgroundColor = isActiveSection ?
            (index % 2 === 0 ? '#fff5f5' : '#ffebeb') :
            (isActive && !isQuickAccess ?
                (index % 2 === 0 ? '#f0fff0' : '#e8f5e8') :
                (index % 2 === 0 ? '#f9f9f9' : 'white'));

        const item = createElem('div', {
            style: `padding: 4px 6px; border-bottom: 1px solid #eee; background: ${backgroundColor}; ${isActive && !isQuickAccess && !isActiveSection ? 'border-left: 3px solid #4caf50;' : ''}`
        });

        const header = createElem('div', {
            style: 'display: flex; align-items: center; margin-bottom: 2px; gap: 4px;'
        });

        // Layer visibility checkbox
        const visibilityCheckbox = createElem('input', {
            type: 'checkbox',
            style: 'margin-right: 6px; accent-color: #2E7D32; width: 16px; height: 16px; flex-shrink: 0;'
        });
        visibilityCheckbox.checked = activeLayers.has(layer.id);
        visibilityCheckbox.addEventListener('change', (e) => {
            toggleLayer(layer, e.target.checked);
        });

        // Layer title with service indicator
        const titleContainer = createElem('span', {
            style: 'flex: 1; display: flex; align-items: center; gap: 4px;'
        });

        const serviceIndicator = createElem('span', {
            style: 'background: #2E7D32; color: white; padding: 1px 4px; border-radius: 2px; font-size: 8px; font-weight: bold;',
            textContent: layer.service.shortName
        });

        const title = createElem('span', {
            style: 'font-weight: bold; font-size: 11px;',
            textContent: layer.title
        });

        titleContainer.appendChild(serviceIndicator);
        titleContainer.appendChild(title);

        // Add active indicator in main list
        if (!isQuickAccess && !isActiveSection && isActive) {
            const activeIndicator = createElem('span', {
                style: 'color: #4caf50; font-size: 10px; font-weight: bold;',
                textContent: '●',
                title: 'Taso on aktiivinen'
            });
            titleContainer.appendChild(activeIndicator);
        }

        // Quick access toggle (only in main list)
        if (!isQuickAccess && !isActiveSection) {
            const quickToggle = createElem('button', {
                style: `
                    width: 16px;
                    height: 16px;
                    padding: 0;
                    font-size: 9px;
                    border: 1px solid #2E7D32;
                    border-radius: 2px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    ${quickAccessLayers.has(layer.id) ? 'background: #2E7D32; color: white;' : 'background: white; color: #2E7D32;'}
                `,
                textContent: quickAccessLayers.has(layer.id) ? '★' : '☆',
                title: 'Lisää/poista pika-aktivoinnista'
            });
            quickToggle.addEventListener('click', () => {
                toggleQuickAccess(layer);
            });
            header.appendChild(quickToggle);
        }

        // Show quick access status in active section
        if (isActiveSection && quickAccessLayers.has(layer.id)) {
            const quickAccessIndicator = createElem('span', {
                style: `
                    width: 16px;
                    height: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 9px;
                    color: #2E7D32;
                    flex-shrink: 0;
                `,
                textContent: '★',
                title: 'Taso on pika-aktivoinnissa'
            });
            header.appendChild(quickAccessIndicator);
        }

        header.appendChild(visibilityCheckbox);
        header.appendChild(titleContainer);
        item.appendChild(header);

        // Layer details
        const details = createElem('div', {
            style: 'font-size: 9px; color: #666; margin-left: 20px;'
        });

        const layerName = createElem('div', {
            style: 'font-family: monospace; margin-bottom: 1px; font-size: 9px;',
            textContent: layer.name
        });
        details.appendChild(layerName);

        const serviceInfo = createElem('div', {
            style: 'font-size: 9px; color: #2E7D32; margin-bottom: 1px;',
            textContent: `${layer.service.name} - ${layer.service.description}`
        });
        details.appendChild(serviceInfo);

        if (layer.abstract) {
            const abstract = createElem('div', {
                style: 'font-size: 9px;',
                textContent: layer.abstract.substring(0, 80) + (layer.abstract.length > 80 ? '...' : '')
            });
            details.appendChild(abstract);
        }

        item.appendChild(details);

        // Opacity slider (only if layer is active)
        if (activeLayers.has(layer.id)) {
            const opacityContainer = createElem('div', {
                style: 'margin: 4px 0 0 20px; display: flex; align-items: center;'
            });

            const opacityLabel = createElem('span', {
                style: 'font-size: 9px; margin-right: 4px;',
                textContent: 'Läpinäkyvyys:'
            });

            const opacitySlider = createElem('input', {
                type: 'range',
                min: '0.1',
                max: '1',
                step: '0.1',
                value: layer.opacity.toString(),
                style: 'flex: 1; margin-right: 4px; height: 12px;'
            });

            const opacityValue = createElem('span', {
                style: 'font-size: 9px; min-width: 25px;',
                textContent: Math.round(layer.opacity * 100) + '%'
            });

            let opacityTimeout;
            opacitySlider.addEventListener('input', (e) => {
                const opacity = parseFloat(e.target.value);
                layer.opacity = opacity;
                opacityValue.textContent = Math.round(opacity * 100) + '%';

                const wmsLayer = activeLayers.get(layer.id);
                if (wmsLayer) {
                    wmsLayer.setOpacity(opacity);
                }

                clearTimeout(opacityTimeout);
                opacityTimeout = setTimeout(() => savePreferences(), 1000);
            });

            opacityContainer.appendChild(opacityLabel);
            opacityContainer.appendChild(opacitySlider);
            opacityContainer.appendChild(opacityValue);
            item.appendChild(opacityContainer);


        }

        return item;
    }

    // Toggle layer visibility
    function toggleLayer(layerConfig, visible) {
        if (visible && !activeLayers.has(layerConfig.id)) {
            const wmsLayer = createWMSLayer(layerConfig);
            if (wmsLayer) {
                W.map.getOLMap().addLayer(wmsLayer);
                activeLayers.set(layerConfig.id, wmsLayer);
                layerConfig.visible = true;
                console.log(`✓ Added layer: ${layerConfig.title} (${layerConfig.service.name})`);
            }
        } else if (!visible && activeLayers.has(layerConfig.id)) {
            const wmsLayer = activeLayers.get(layerConfig.id);
            W.map.getOLMap().removeLayer(wmsLayer);
            activeLayers.delete(layerConfig.id);
            layerConfig.visible = false;
            console.log(`✗ Removed layer: ${layerConfig.title} (${layerConfig.service.name})`);
        }

        savePreferences();
        if (sidebarPanel) {
            renderLayerList(sidebarPanel.searchInput.value);
        }
        const floatingPanel = document.getElementById('inspire-mml-floating-panel');
        if (floatingPanel) {
            updateFloatingButton(floatingPanel);
        }
    }

    // Create OpenLayers WMS layer
    function createWMSLayer(layerConfig) {
        try {
            const wmsLayer = new OpenLayers.Layer.WMS(
                `INSPIRE MML: ${layerConfig.title}`,
                layerConfig.service.url,
                {
                    layers: layerConfig.name,
                    transparent: true,
                    format: 'image/png',
                    version: WMS_CONFIG.version,
                    crs: WMS_CONFIG.crs
                },
                {
                    isBaseLayer: false,
                    visibility: true,
                    opacity: layerConfig.opacity,
                    displayInLayerSwitcher: false,
                    transitionEffect: null,
                    tileOptions: {
                        crossOriginKeyword: null
                    },
                    singleTile: false,
                    ratio: 1,
                    buffer: 0,
                    numZoomLevels: 20
                }
            );

            wmsLayer.events.register('tileerror', wmsLayer, function (evt) {
                console.warn(`Tile load error for ${layerConfig.title}:`, evt.url);
            });

            return wmsLayer;
        } catch (error) {
            console.error(`Failed to create layer ${layerConfig.title}:`, error);
            return null;
        }
    }

    // Toggle quick access for layer
    function toggleQuickAccess(layer) {
        if (quickAccessLayers.has(layer.id)) {
            quickAccessLayers.delete(layer.id);
        } else {
            quickAccessLayers.add(layer.id);
        }
        savePreferences();
        renderLayerList(sidebarPanel.searchInput.value);
    }

    // Create floating button
    function createFloatingButton() {
        if (floatingButton) {
            floatingButton.remove();
        }
        const existingPanel = document.getElementById('inspire-mml-floating-panel');
        if (existingPanel) {
            existingPanel.remove();
        }

        floatingButton = createElem('button', {
            id: 'inspire-mml-toggle-btn',
            style: `
                position: fixed;
                top: 64px;
                left: 465px;
                z-index: 10000;
                width: 40px;
                height: 40px;
                padding: 0;
                background: #2E7D32;
                color: white;
                border: 2px solid #333;
                border-radius: 6px;
                cursor: grab;
                font-size: 18px;
                box-shadow: 0 3px 8px rgba(0,0,0,0.4);
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
            `,
            innerHTML: '🗺️',
            title: 'Näytä/piilota INSPIRE Maanmittauslaitos pika-aktivointi'
        });

        const floatingPanel = createElem('div', {
            id: 'inspire-mml-floating-panel',
            style: `
                position: fixed;
                top: 125px;
                left: 10px;
                background: white;
                border: 2px solid #2E7D32;
                border-radius: 8px;
                padding: 10px;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                max-width: 280px;
                display: none;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
            `
        });

        updateFloatingButton(floatingPanel);
        setupFloatingButtonEvents(floatingPanel);

        document.body.appendChild(floatingButton);
        document.body.appendChild(floatingPanel);

        loadButtonPosition();
    }

    // Update floating button content
    function updateFloatingButton(floatingPanel) {
        if (!floatingButton || !floatingPanel) return;

        const quickLayers = availableLayers.filter(layer => quickAccessLayers.has(layer.id));

        floatingButton.innerHTML = '🗺️';

        floatingPanel.innerHTML = '';

        if (quickLayers.length === 0) {
            const emptyMsg = createElem('div', {
                style: 'color: #666; font-size: 11px; text-align: center; padding: 10px;',
                textContent: 'Ei pika-aktivointi tasoja. Valitse tasoja sivupaneelista.'
            });
            floatingPanel.appendChild(emptyMsg);
            return;
        }

        // Panel header
        const header = createElem('div', {
            style: 'font-weight: bold; margin-bottom: 8px; font-size: 13px; color: #2E7D32; border-bottom: 1px solid #2E7D32; padding-bottom: 4px;',
            innerHTML: '<strong>INSPIRE Maanmittauslaitos</strong>'
        });
        floatingPanel.appendChild(header);

        // Add quick access layers grouped by service
        const serviceGroups = {};
        quickLayers.forEach(layer => {
            if (!serviceGroups[layer.service.shortName]) {
                serviceGroups[layer.service.shortName] = [];
            }
            serviceGroups[layer.service.shortName].push(layer);
        });

        Object.entries(serviceGroups).forEach(([serviceShortName, layers]) => {
            const service = layers[0].service;

            // Service header
            const serviceHeader = createElem('div', {
                style: 'font-size: 10px; font-weight: bold; color: #2E7D32; margin: 6px 0 3px 0; padding: 2px 4px; background: #f0f8f0; border-radius: 2px;',
                textContent: `${service.name} (${service.shortName})`
            });
            floatingPanel.appendChild(serviceHeader);

            layers.forEach((layer, index) => {
                const toggle = createElem('div', {
                    style: `display: flex; align-items: center; margin-bottom: 4px; padding: 3px; border-radius: 3px; transition: background-color 0.2s; background-color: ${index % 2 === 0 ? '#f9f9f9' : 'white'}; gap: 4px;`
                });

                toggle.addEventListener('mouseenter', function () {
                    this.style.backgroundColor = '#e8f5e9';
                });

                toggle.addEventListener('mouseleave', function () {
                    this.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white';
                });

                const checkbox = createElem('input', {
                    type: 'checkbox',
                    style: 'margin-right: 6px; accent-color: #2E7D32; width: 16px; height: 16px; flex-shrink: 0;'
                });
                checkbox.checked = activeLayers.has(layer.id);
                checkbox.addEventListener('change', (e) => {
                    toggleLayer(layer, e.target.checked);
                });

                const label = createElem('span', {
                    textContent: layer.title,
                    style: 'user-select: none; font-size: 11px; color: #333; flex: 1; cursor: pointer;'
                });

                label.addEventListener('click', () => {
                    checkbox.checked = !checkbox.checked;
                    toggleLayer(layer, checkbox.checked);
                });

                toggle.appendChild(checkbox);
                toggle.appendChild(label);
                floatingPanel.appendChild(toggle);
            });
        });

        // Info section
        const infoDiv = createElem('div', {
            style: 'margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 9px; color: #666;',
            innerHTML: '<strong>Lähde:</strong> Maanmittauslaitos INSPIRE<br><strong>Lisenssi:</strong> CC BY 4.0'
        });
        floatingPanel.appendChild(infoDiv);
    }

    // Setup floating button drag functionality
    function setupFloatingButtonEvents(floatingPanel) {
        let isDragging = false;

        floatingButton.addEventListener('mouseenter', function () {
            if (!isDragging) {
                this.style.transform = 'scale(1.1)';
                this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
            }
        });

        floatingButton.addEventListener('mouseleave', function () {
            if (!isDragging) {
                this.style.transform = 'scale(1)';
                this.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4)';
            }
        });

        // Toggle panel visibility
        floatingButton.addEventListener('click', function () {
            if (isDragging) return;

            if (floatingPanel.style.display === 'none' || floatingPanel.style.display === '') {
                floatingPanel.style.left = floatingButton.style.left;
                floatingPanel.style.top = (parseInt(floatingButton.style.top) + 45) + 'px';
                floatingPanel.style.display = 'block';
                this.style.borderColor = '#2E7D32';
                this.style.borderWidth = '3px';
            } else {
                floatingPanel.style.display = 'none';
                this.style.borderColor = '#333';
                this.style.borderWidth = '2px';
            }
        });

        // Drag functionality
        floatingButton.addEventListener('mousedown', function (e) {
            e.preventDefault();
            isDragging = false;

            const shiftX = e.clientX - floatingButton.getBoundingClientRect().left;
            const shiftY = e.clientY - floatingButton.getBoundingClientRect().top;

            function moveAt(pageX, pageY) {
                isDragging = true;
                floatingButton.style.left = (pageX - shiftX) + 'px';
                floatingButton.style.top = (pageY - shiftY) + 'px';
                if (floatingPanel.style.display === 'block') {
                    floatingPanel.style.left = floatingButton.style.left;
                    floatingPanel.style.top = (parseInt(floatingButton.style.top) + 45) + 'px';
                }
            }

            function mouseMoveHandler(e) {
                moveAt(e.pageX, e.pageY);
            }

            function mouseUpHandler() {
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);

                if (isDragging) {
                    savePreferences();
                    setTimeout(() => isDragging = false, 100);
                }
            }

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });

        floatingButton.addEventListener('dragstart', () => false);
    }

    // Initialize script
    function initializeScript() {
        console.log('WME INSPIRE MML: WME ready, initializing...');
        if (W?.userscripts?.state.isReady) {
            init();
        } else {
            document.addEventListener('wme-ready', init, { once: true });
        }
    }

    // Start initialization
    if (W?.userscripts?.state.isInitialized) {
        initializeScript();
    } else {
        document.addEventListener('wme-initialized', initializeScript, { once: true });
    }

    console.log('WME INSPIRE MML: Script loaded');
})();