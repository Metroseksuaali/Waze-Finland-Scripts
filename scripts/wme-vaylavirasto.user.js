// ==UserScript==
// @name         WME Väylävirasto
// @namespace    https://github.com/Metroseksuaali/Waze-Finland-Scripts
// @version      2.1.1
// @description  Suomen Väyläviraston WMS‑tasot Waze Map Editoria varten
// @author       Stemmi
// @match        https://*.waze.com/*editor*
// @grant        GM_xmlhttpRequest
// @connect      avoinapi.vaylapilvi.fi
// @license      MIT
// ==/UserScript==
     
    (function () {
        'use strict';
     
        console.log('WME Väylävirasto: Starting...');
     
        // Global state
        let availableLayers = [];
        let activeLayers = new Map();
        let quickAccessLayers = new Set();
        let floatingButton = null;
        let sidebarPanel = null;
        let selectedProvider = null; // Provider filter state (null = all providers)
      
        // Configuration
        const WMS_CONFIG = {
            baseUrl: 'https://avoinapi.vaylapilvi.fi/vaylatiedot/wms',
            version: '1.3.0',
            crs: 'EPSG:3857'
        };
     
        // LocalStorage keys
        const STORAGE_KEYS = {
            quickAccess: 'wme-vaylavirasto-quickaccess',
            activeLayers: 'wme-vaylavirasto-active',
            layerOpacity: 'wme-vaylavirasto-opacity',
            buttonPosition: 'wme-vaylavirasto-position',
            initialized: 'wme-vaylavirasto-initialized'
        };

        // Default quick-access layers for new users
        const DEFAULT_QUICK_ACCESS_LAYERS = [
            'digiroad:dr_leveys',              // Road width
            'digiroad:dr_nopeusrajoitus',      // Speed limits
            'digiroad:dr_talvinopeusrajoitus', // Winter speed limits
            'digiroad:dr_tielinkki_tielinkin_tyyppi', // Junction types
            'digiroad:tiekunnalliset_yksityistiet' // Private roads
        ];
     
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
                    // Save quick access layers
                    localStorage.setItem(STORAGE_KEYS.quickAccess, JSON.stringify(Array.from(quickAccessLayers)));
         
                    // Save active layers
                    localStorage.setItem(STORAGE_KEYS.activeLayers, JSON.stringify(Array.from(activeLayers.keys())));
         
                    // Save layer opacities
                    const opacities = {};
                    availableLayers.forEach(layer => {
                        if (layer.opacity !== 0.8) { // Only save if different from default
                            opacities[layer.name] = layer.opacity;
                        }
                    });
                    localStorage.setItem(STORAGE_KEYS.layerOpacity, JSON.stringify(opacities));
         
                    // Save button position
                    if (floatingButton) {
                        const position = {
                            top: floatingButton.style.top,
                            left: floatingButton.style.left
                        };
                        localStorage.setItem(STORAGE_KEYS.buttonPosition, JSON.stringify(position));
                    }
                } catch (error) {
                    console.warn('WME Väylävirasto: Failed to save preferences:', error);
                }
            }, 500); // Debounce for 500ms
        }
     
        // Load preferences from localStorage
        function loadPreferences() {
            try {
                // Check if user has used the script before
                const hasUsedBefore = localStorage.getItem(STORAGE_KEYS.initialized);
                
                // Load quick access layers
                const savedQuickAccess = localStorage.getItem(STORAGE_KEYS.quickAccess);
                if (savedQuickAccess) {
                    const quickAccessArray = JSON.parse(savedQuickAccess);
                    quickAccessLayers = new Set(quickAccessArray);
                } else if (!hasUsedBefore) {
                    // First time user - add default quick-access layers
                    DEFAULT_QUICK_ACCESS_LAYERS.forEach(layerName => {
                        // Only add if layer exists in available layers
                        if (availableLayers.some(l => l.name === layerName)) {
                            quickAccessLayers.add(layerName);
                        }
                    });
                    
                    // Mark as initialized and save
                    localStorage.setItem(STORAGE_KEYS.initialized, 'true');
                    savePreferences();
                }
                // If hasUsedBefore is true but no saved quick access, user intentionally cleared them - don't re-add

                // Load layer opacities
                const savedOpacities = localStorage.getItem(STORAGE_KEYS.layerOpacity);
                if (savedOpacities) {
                    const opacities = JSON.parse(savedOpacities);
                    availableLayers.forEach(layer => {
                        if (opacities[layer.name]) {
                            layer.opacity = opacities[layer.name];
                        }
                    });
                }

                // Load and restore active layers
                const savedActiveLayers = localStorage.getItem(STORAGE_KEYS.activeLayers);
                if (savedActiveLayers) {
                    const activeLayerNames = JSON.parse(savedActiveLayers);

                    // Restore layers after a short delay to ensure map is ready
                    setTimeout(() => {
                        activeLayerNames.forEach(layerName => {
                            const layerConfig = availableLayers.find(l => l.name === layerName);
                            if (layerConfig) {
                                toggleLayer(layerConfig, true);
                            }
                        });
                    }, 1000);
                }

            } catch (error) {
                console.warn('WME Väylävirasto: Failed to load preferences:', error);
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
                    } else {
                        // Use default positions if saved values are invalid
                        floatingButton.style.top = '64px';
                        floatingButton.style.left = '415px';
                    }
                }
            } catch (error) {
                console.warn('WME Väylävirasto: Failed to load button position:', error);
            }
        }
     
        // Wait for WME to load
        let initRetries = 0;
        const MAX_INIT_RETRIES = 60; // 30 seconds total
     
        function init() {
            if (typeof W === 'undefined' || typeof W.map === 'undefined' || typeof OpenLayers === 'undefined') {
                if (initRetries < MAX_INIT_RETRIES) {
                    initRetries++;
                    setTimeout(init, 500);
                } else {
                    console.error('WME Väylävirasto: Failed to initialize after maximum retries');
                }
                return;
            }
     
            console.log('WME Väylävirasto: WME loaded, fetching capabilities...');
            fetchWMSCapabilities();
        }
     
        // Fetch available layers from WMS GetCapabilities
        async function fetchWMSCapabilities() {
            try {
                const capabilitiesUrl = `${WMS_CONFIG.baseUrl}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=${WMS_CONFIG.version}`;
         
                // Use GM_xmlhttpRequest if available, otherwise fetch
                if (typeof GM_xmlhttpRequest !== 'undefined') {
                    return new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: capabilitiesUrl,
                            onload: function (response) {
                                try {
                                    parseCapabilities(response.responseText);
                                    resolve();
                                } catch (error) {
                                    reject(error);
                                }
                            },
                            onerror: reject
                        });
                    });
                } else {
                    const response = await fetch(capabilitiesUrl, {
                        mode: 'cors',
                        credentials: 'omit'
                    });
                    const xmlText = await response.text();
                    parseCapabilities(xmlText);
                }
         
            } catch (error) {
                console.error('WME Väylävirasto: Failed to fetch capabilities:', error);
                // Fallback to hardcoded layers if fetch fails
                availableLayers = getDefaultLayers();
                loadPreferences();
                initializeUI();
            }
        }
     
        // Parse capabilities XML
        function parseCapabilities(xmlText) {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

            // Parse layers from capabilities - Use original working querySelector
            const layers = xmlDoc.querySelectorAll('Layer[queryable="1"]');

            availableLayers = Array.from(layers).map(layer => {
                const name = layer.querySelector('Name')?.textContent;
                const title = layer.querySelector('Title')?.textContent;
                const abstract = layer.querySelector('Abstract')?.textContent;

                if (name && title) {
                    return {
                        name: name,
                        title: title,
                        abstract: abstract || '',
                        visible: false,
                        opacity: 0.8
                    };
                }
                return null;
            }).filter(Boolean);

            console.log(`WME Väylävirasto: Found ${availableLayers.length} layers from GetCapabilities`);

            // Load saved preferences
            loadPreferences();

            // Initialize UI after layers are loaded
            initializeUI();
        }
     
        // Fallback layers if GetCapabilities fails
        function getDefaultLayers() {
            return [
                {
                    name: 'tiestotiedot:liikennemaarat_2023',
                    title: 'Liikennemäärät 2023',
                    abstract: 'Liikennemäärätiedot vuodelta 2023',
                    visible: false,
                    opacity: 0.7
                },
                {
                    name: 'digiroad:dr_nopeusrajoitus',
                    title: 'Nopeusrajoitukset',
                    abstract: 'Teiden nopeusrajoitukset',
                    visible: false,
                    opacity: 0.8
                },
                {
                    name: 'digiroad:dr_liikennemerkit',
                    title: 'Liikennemerkit',
                    abstract: 'Liikennemerkkien sijainnit',
                    visible: false,
                    opacity: 0.9
                }
            ];
        }
      
        // Extract provider from layer name (format: "provider:specific_layer")
        function getProvider(layerName) {
            const parts = layerName.split(':');
            return parts.length > 1 ? parts[0] : 'Other';
        }
      
        // Get unique list of providers from available layers
        function getUniqueProviders() {
            const providers = new Set();
            availableLayers.forEach(layer => {
                const provider = getProvider(layer.name);
                providers.add(provider);
            });
            return Array.from(providers).sort();
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
            // Declare variables in outer scope to avoid ReferenceError
            let tabLabel, tabPane;
      
            // Add error handling for W.userscripts API
            try {
                const result = W.userscripts.registerSidebarTab('Väylävirasto');
                tabLabel = result.tabLabel;
                tabPane = result.tabPane;
                
                if (!tabLabel || !tabPane) {
                    console.error('WME Väylävirasto: tabLabel or tabPane is undefined!');
                    return;
                }
                
                tabLabel.textContent = '🇫🇮';
                tabLabel.title = 'Väylävirasto WMS Layers';
            } catch (error) {
                console.error('WME Väylävirasto: Failed to register sidebar tab:', error);
                return;
            }
     
            const divRoot = createElem('div', { style: 'padding: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px;' });
     
            // Header
            const header = createElem('h4', {
                style: 'font-weight: bold; margin: 0 0 8px 0; color: #0052A5; font-size: 14px;',
                textContent: 'Väylävirasto WMS'
            });
            divRoot.appendChild(header);
     
            const version = createElem('div', {
                style: 'margin: 0 0 8px 0; font-size: 10px; color: #999;',
                textContent: 'Version 2.1.1'
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
      
            // Provider filter dropdown
            const filterContainer = createElem('div', { style: 'margin-bottom: 8px;' });
            const filterLabel = createElem('label', {
                style: 'font-size: 10px; color: #666; margin-right: 4px;',
                textContent: 'Tarjoaja:'
            });
            const providerFilter = createElem('select', {
                style: 'width: 100%; padding: 4px 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 11px; background: white;'
            });
            
            // Add "All providers" option
            const allOption = createElem('option', {
                value: '',
                textContent: 'Kaikki tarjoajat'
            });
            providerFilter.appendChild(allOption);
            
            // Add provider options dynamically
            const providers = getUniqueProviders();
            providers.forEach(provider => {
                const option = createElem('option', {
                    value: provider,
                    textContent: provider.charAt(0).toUpperCase() + provider.slice(1)
                });
                providerFilter.appendChild(option);
            });
            
            // Handle filter change
            providerFilter.addEventListener('change', (e) => {
                selectedProvider = e.target.value || null;
                renderLayerList(sidebarPanel.searchInput.value);
            });
            
            filterContainer.appendChild(filterLabel);
            filterContainer.appendChild(providerFilter);
            divRoot.appendChild(filterContainer);
      
            // Layer count info
            const layerInfo = createElem('div', {
                style: 'margin-bottom: 6px; font-size: 10px; color: #666;',
                textContent: `${availableLayers.length} tasoa saatavilla`
            });
            divRoot.appendChild(layerInfo);
     
            // Active layers section (always visible)
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
                style: 'margin: 8px 0 4px 0; color: #0052A5; font-size: 12px;',
                textContent: 'Pika-aktivointi'
            });
            divRoot.appendChild(quickAccessHeader);
     
            const quickAccessInfo = createElem('div', {
                style: 'font-size: 10px; color: #666; margin-bottom: 6px;',
                textContent: 'Valitse tasot kelluvaan painikkeeseen:'
            });
            divRoot.appendChild(quickAccessInfo);
     
            // Calculate dynamic height for quick access section
            const headerHeight = 250; // Approximate height of header elements
            const minAvailableHeight = 200;
            const availableHeight = Math.max(minAvailableHeight, window.innerHeight - headerHeight);
            const quickAccessList = createElem('div', {
                style: `max-height: ${availableHeight}px; overflow-y: auto; border: 1px solid #ddd; border-radius: 3px; padding: 3px;`
            });
            divRoot.appendChild(quickAccessList);
      
            try {
                tabPane.appendChild(divRoot);
            } catch (appendError) {
                console.error('WME Väylävirasto: FAILED to append divRoot to tabPane:', appendError);
                return;
            }
            
            tabPane.id = 'sidepanel-vaylavirasto';
            
            // Wait for element to be connected (required for WME userscript API)
            try {
                await W.userscripts.waitForElementConnected(tabPane);
            } catch (error) {
                console.warn('WME Väylävirasto: waitForElementConnected failed (continuing anyway):', error.message);
            }
      
            sidebarPanel = {
                searchInput,
                layerList,
                quickAccessList,
                activeLayersList,
                layerInfo,
                activeLayersInfo
            };
      
            // Setup event listeners
            setupSidebarEvents();
            renderLayerList();
        }
        // Setup sidebar event listeners
        function setupSidebarEvents() {
            // Search functionality
            sidebarPanel.searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                renderLayerList(searchTerm);
            });
        }
     
        // Render layer list with optional search filter and provider filter
        function renderLayerList(searchTerm = '') {
            if (!sidebarPanel) {
                return;
            }
            
            // Apply both search and provider filters
            let filteredLayers = availableLayers.filter(layer => {
                // Search filter
                const matchesSearch = !searchTerm ||
                    layer.title.toLowerCase().includes(searchTerm) ||
                    layer.name.toLowerCase().includes(searchTerm) ||
                    (layer.abstract || '').toLowerCase().includes(searchTerm);
                
                // Provider filter
                const matchesProvider = !selectedProvider ||
                    getProvider(layer.name) === selectedProvider;
                
                return matchesSearch && matchesProvider;
            });
       
            // Update layer count info to show active filters
            let countText = `${filteredLayers.length} tasoa`;
            if (searchTerm || selectedProvider) {
                countText += ` / ${availableLayers.length} tasoa`;
            }
            sidebarPanel.layerInfo.textContent = countText;
       
            // Clear existing content
            sidebarPanel.layerList.innerHTML = '';
            sidebarPanel.quickAccessList.innerHTML = '';
            sidebarPanel.activeLayersList.innerHTML = '';
     
            // Render active layers section (always visible, regardless of search)
            const activeLayersArray = availableLayers.filter(layer => activeLayers.has(layer.name));
     
            if (activeLayersArray.length === 0) {
                const emptyMsg = createElem('div', {
                    style: 'color: #999; font-size: 10px; text-align: center; padding: 8px; font-style: italic;',
                    textContent: 'Ei aktiivisia tasoja'
                });
                sidebarPanel.activeLayersList.appendChild(emptyMsg);
            } else {
                activeLayersArray.forEach((layer, index) => {
                    const activeItem = createLayerItem(layer, index, false, true); // true for isActiveSection
                    sidebarPanel.activeLayersList.appendChild(activeItem);
                });
            }
     
            // Update active layers info
            sidebarPanel.activeLayersInfo.textContent = activeLayersArray.length === 0 ?
                'Ei aktiivisia tasoja' :
                `${activeLayersArray.length} tasoa aktiivinen${activeLayersArray.length !== 1 ? 'a' : ''}`;
     
            // Render main layer list
            filteredLayers.forEach((layer, index) => {
                const layerItem = createLayerItem(layer, index, false, false);
                sidebarPanel.layerList.appendChild(layerItem);
            });
     
            // Render quick access list (only layers that are in quick access)
            availableLayers.filter(layer => quickAccessLayers.has(layer.name)).forEach((layer, index) => {
                const quickItem = createLayerItem(layer, index, true, false);
                sidebarPanel.quickAccessList.appendChild(quickItem);
            });
     
            updateFloatingButton(document.getElementById('vayla-floating-panel'));
        }
     
        // Open legend window for a layer
        function openLegendWindow(layerConfig) {
            if (!layerConfig || !layerConfig.name) {
                console.warn('Invalid layer config for legend window');
                return;
            }
     
            const legendUrl = `${WMS_CONFIG.baseUrl}?service=WMS&version=${WMS_CONFIG.version}&request=GetLegendGraphic&format=image/png&layer=${layerConfig.name}`;
     
            // Check if window already exists for this layer
            const windowId = 'legend-' + layerConfig.name.replace(/[^a-zA-Z0-9]/g, '-');
            const existingWindow = document.getElementById(windowId);
     
            if (existingWindow) {
                // Bring existing window to front
                existingWindow.style.zIndex = '10001';
                return;
            }
     
            // Create floatable legend window
            const legendWindow = createElem('div', {
                id: windowId,
                style: `
                    position: fixed;
                    top: 200px;
                    left: 500px;
                    background: white;
                    border: 2px solid #0052A5;
                    border-radius: 8px;
                    z-index: 10001;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    min-width: 200px;
                    max-width: 400px;
                `
            });
     
            // Create header with title and close button
            const header = createElem('div', {
                style: `
                    background: #0052A5;
                    color: white;
                    padding: 8px 12px;
                    border-radius: 6px 6px 0 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                    user-select: none;
                `
            });
     
            const title = createElem('span', {
                textContent: 'Selite: ' + layerConfig.title,
                style: 'font-size: 14px; font-weight: bold;'
            });
     
            const closeBtn = createElem('button', {
                innerHTML: '✕',
                style: `
                    background: none;
                    border: none;
                    color: white;
                    font-size: 16px;
                    cursor: pointer;
                    padding: 0;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `
            });
     
            closeBtn.addEventListener('mouseenter', function () {
                this.style.background = 'rgba(255,255,255,0.2)';
            });
     
            closeBtn.addEventListener('mouseleave', function () {
                this.style.background = 'none';
            });
     
            // Memory leak fix: Store handler references and remove on close
            let mouseMoveHandler = null;
            let mouseUpHandler = null;
            
            closeBtn.addEventListener('click', function () {
                // Remove drag event listeners to prevent memory leaks
                if (mouseMoveHandler) {
                    document.removeEventListener('mousemove', mouseMoveHandler);
                }
                if (mouseUpHandler) {
                    document.removeEventListener('mouseup', mouseUpHandler);
                }
                legendWindow.remove();
            });
     
            header.appendChild(title);
            header.appendChild(closeBtn);
     
            // Create content area
            const content = createElem('div', {
                style: 'padding: 12px; text-align: center;'
            });
     
            const loadingText = createElem('div', {
                textContent: 'Ladataan selitettä...',
                style: 'color: #666; font-size: 13px;'
            });
            content.appendChild(loadingText);
     
            // Create image element
            const legendImg = createElem('img', {
                src: legendUrl,
                style: 'max-width: 100%; height: auto; display: none;'
            });
     
            legendImg.addEventListener('load', function () {
                loadingText.style.display = 'none';
                this.style.display = 'block';
            });
     
            legendImg.addEventListener('error', function () {
                loadingText.textContent = 'Selitettä ei voitu ladata';
                loadingText.style.color = '#d32f2f';
            });
     
            content.appendChild(legendImg);
            legendWindow.appendChild(header);
            legendWindow.appendChild(content);
     
            // Make window draggable
            let isDragging = false;
            let dragOffset = { x: 0, y: 0 };
     
            header.addEventListener('mousedown', function (e) {
                isDragging = true;
                dragOffset.x = e.clientX - legendWindow.offsetLeft;
                dragOffset.y = e.clientY - legendWindow.offsetTop;
                legendWindow.style.zIndex = '10001';
            });
     
            mouseMoveHandler = function (e) {
                if (isDragging) {
                    legendWindow.style.left = (e.clientX - dragOffset.x) + 'px';
                    legendWindow.style.top = (e.clientY - dragOffset.y) + 'px';
                }
            };
            
            document.addEventListener('mousemove', mouseMoveHandler);
     
            mouseUpHandler = function () {
                isDragging = false;
            };
            
            document.addEventListener('mouseup', mouseUpHandler);
     
            document.body.appendChild(legendWindow);
        }
     
        // Create individual layer item
        function createLayerItem(layer, index, isQuickAccess, isActiveSection = false) {
            const isActive = activeLayers.has(layer.name);
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
                style: 'margin-right: 6px; accent-color: #0052A5; width: 16px; height: 16px; flex-shrink: 0;'
            });
            visibilityCheckbox.checked = activeLayers.has(layer.name);
            visibilityCheckbox.addEventListener('change', (e) => {
                toggleLayer(layer, e.target.checked);
            });
     
            // Layer title with active indicator
            const titleContainer = createElem('span', {
                style: 'flex: 1; display: flex; align-items: center; gap: 4px;'
            });
     
            const title = createElem('span', {
                style: 'font-weight: bold; font-size: 11px;',
                textContent: layer.title
            });
     
            titleContainer.appendChild(title);
     
            // Add active indicator in main list (not in active or quick access sections)
            if (!isQuickAccess && !isActiveSection && isActive) {
                const activeIndicator = createElem('span', {
                    style: 'color: #4caf50; font-size: 10px; font-weight: bold;',
                    textContent: '●',
                    title: 'Taso on aktiivinen'
                });
                titleContainer.appendChild(activeIndicator);
            }
     
            // Legend button
            const legendBtn = createElem('button', {
                innerHTML: 'ℹ️',
                title: 'Näytä selite',
                style: `
                    width: 16px;
                    height: 16px;
                    padding: 0;
                    background: #f0f0f0;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                    flex-shrink: 0;
                `
            });
     
            legendBtn.addEventListener('mouseenter', function () {
                this.style.background = '#e0e0e0';
                this.style.transform = 'scale(1.1)';
            });
     
            legendBtn.addEventListener('mouseleave', function () {
                this.style.background = '#f0f0f0';
                this.style.transform = 'scale(1)';
            });
     
            legendBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                openLegendWindow(layer);
            });
     
            // Quick access toggle (in main list and quick access section, but not in active section)
            if (!isActiveSection) {
                const isQuickAccessItem = quickAccessLayers.has(layer.name);
                const quickToggle = createElem('button', {
                    style: `
                        width: 16px;
                        height: 16px;
                        padding: 0;
                        font-size: 9px;
                        border: 1px solid #0052A5;
                        border-radius: 2px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                        ${isQuickAccessItem ? 'background: #0052A5; color: white;' : 'background: white; color: #0052A5;'}
                    `,
                    textContent: isQuickAccessItem ? '★' : '☆',
                    title: isQuickAccessItem ? 'Poista pika-aktivoinnista' : 'Lisää pika-aktivointiin'
                });
                quickToggle.addEventListener('click', () => {
                    toggleQuickAccess(layer);
                });
                header.appendChild(quickToggle);
            }
     
            // Show quick access status in active section
            if (isActiveSection && quickAccessLayers.has(layer.name)) {
                const quickAccessIndicator = createElem('span', {
                    style: `
                        width: 16px;
                        height: 16px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 9px;
                        color: #0052A5;
                        flex-shrink: 0;
                    `,
                    textContent: '★',
                    title: 'Taso on pika-aktivoinnissa'
                });
                header.appendChild(quickAccessIndicator);
            }
     
            header.appendChild(visibilityCheckbox);
            header.appendChild(titleContainer);
            header.appendChild(legendBtn);
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
     
            if (layer.abstract) {
                const abstract = createElem('div', {
                    style: 'font-size: 9px;',
                    textContent: (layer.abstract || '').substring(0, 80) + ((layer.abstract || '').length > 80 ? '...' : '')
                });
                details.appendChild(abstract);
            }
     
            item.appendChild(details);
     
            // Opacity slider (only if layer is active)
            if (activeLayers.has(layer.name)) {
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
     
                    const wmsLayer = activeLayers.get(layer.name);
                    if (wmsLayer) {
                        wmsLayer.setOpacity(opacity);
                    }
     
                    // Debounce save for opacity changes
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
            if (visible && !activeLayers.has(layerConfig.name)) {
                // Add layer
                const wmsLayer = createWMSLayer(layerConfig);
                if (wmsLayer) {
                    try {
                        W.map.getOLMap().addLayer(wmsLayer);
                        activeLayers.set(layerConfig.name, wmsLayer);
                        layerConfig.visible = true;
                        console.log(`✓ Added layer: ${layerConfig.title}`);
                    } catch (error) {
                        console.error(`WME Väylävirasto: Failed to add layer ${layerConfig.title}:`, error);
                    }
                }
            } else if (!visible && activeLayers.has(layerConfig.name)) {
                // Remove layer
                const wmsLayer = activeLayers.get(layerConfig.name);
                try {
                    W.map.getOLMap().removeLayer(wmsLayer);
                    activeLayers.delete(layerConfig.name);
                    layerConfig.visible = false;
                    console.log(`✗ Removed layer: ${layerConfig.title}`);
                } catch (error) {
                    console.error(`WME Väylävirasto: Failed to remove layer ${layerConfig.title}:`, error);
                }
            }
     
            savePreferences(); // Save when layer visibility changes
            if (sidebarPanel) {
                renderLayerList(sidebarPanel.searchInput.value);
            }
            const floatingPanel = document.getElementById('vayla-floating-panel');
            if (floatingPanel) {
                updateFloatingButton(floatingPanel);
            }
        }
     
        // Create OpenLayers WMS layer
        function createWMSLayer(layerConfig) {
            try {
                const wmsLayer = new OpenLayers.Layer.WMS(
                    `Väylävirasto: ${layerConfig.title}`,
                    WMS_CONFIG.baseUrl,
                    {
                        layers: layerConfig.name,
                        transparent: true,
                        format: 'image/png',
                        version: WMS_CONFIG.version,
                        crs: WMS_CONFIG.crs  // FIXED: Use 'crs' (not 'srs') - matches WMS_CONFIG definition
                    },
                    {
                        isBaseLayer: false,
                        visibility: true,
                        opacity: layerConfig.opacity,
                        displayInLayerSwitcher: false, // We handle this ourselves
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

                // Add event listeners
                wmsLayer.events.register('tileerror', wmsLayer, function (evt) {
                    // Silently ignore tile errors - network issues are common and transient
                });

                return wmsLayer;
            } catch (error) {
                console.error(`Failed to create layer ${layerConfig.title}:`, error);
                return null;
            }
        }
     
        // Toggle quick access for layer
        function toggleQuickAccess(layer) {
            if (quickAccessLayers.has(layer.name)) {
                quickAccessLayers.delete(layer.name);
            } else {
                quickAccessLayers.add(layer.name);
            }
            savePreferences(); // Save when quick access changes
            renderLayerList(sidebarPanel.searchInput.value);
        }
     
        // Create floating button
        function createFloatingButton() {
            // Remove existing button and panel
            if (floatingButton) {
                floatingButton.remove();
            }
            const existingPanel = document.getElementById('vayla-floating-panel');
            if (existingPanel) {
                existingPanel.remove();
            }
     
            // Create toggle button
            floatingButton = createElem('button', {
                id: 'vayla-toggle-btn',
                style: `
                    position: fixed;
                    top: 64px;
                    left: 415px;
                    z-index: 10000;
                    width: 40px;
                    height: 40px;
                    padding: 0;
                    background: #0052A5;
                    color: white;
                    border: 2px solid #333;
                    border-radius: 6px;
                    cursor: grab;
                    font-size: 22px;
                    box-shadow: 0 3px 8px rgba(0,0,0,0.4);
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `,
                innerHTML: '🇫🇮',
                title: 'Näytä/piilota Väylävirasto pika-aktivointi'
            });
     
            // Create floating panel
            const floatingPanel = createElem('div', {
                id: 'vayla-floating-panel',
                style: `
                    position: fixed;
                    top: 125px;
                    left: 10px;
                    background: white;
                    border: 2px solid #0052A5;
                    border-radius: 8px;
                    padding: 10px;
                    z-index: 10000;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    max-width: 250px;
                    display: none;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 12px;
                `
            });
     
            updateFloatingButton(floatingPanel);
            setupFloatingButtonEvents(floatingPanel);
     
            document.body.appendChild(floatingButton);
            document.body.appendChild(floatingPanel);
     
            // Load saved button position
            loadButtonPosition();
        }
     
        // Update floating button content
        function updateFloatingButton(floatingPanel) {
            if (!floatingButton || !floatingPanel) return;
     
            const quickLayers = availableLayers.filter(layer => quickAccessLayers.has(layer.name));
     
            // Always keep button as simple flag icon
            floatingButton.innerHTML = '🇫🇮';
     
            // Update panel content
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
                style: 'font-weight: bold; margin-bottom: 8px; font-size: 13px; color: #0052A5; border-bottom: 1px solid #0052A5; padding-bottom: 4px;',
                innerHTML: '<strong>Väylävirasto Tasot</strong>'
            });
            floatingPanel.appendChild(header);
     
            // Add quick access layers
            quickLayers.forEach((layer, index) => {
                const toggle = createElem('div', {
                    style: `display: flex; align-items: center; margin-bottom: 6px; padding: 4px; border-radius: 3px; transition: background-color 0.2s; background-color: ${index % 2 === 0 ? '#f9f9f9' : 'white'}; gap: 4px;`
                });
     
                toggle.addEventListener('mouseenter', function () {
                    this.style.backgroundColor = '#e3f2fd';
                });
     
                toggle.addEventListener('mouseleave', function () {
                    this.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white';
                });
     
                const checkbox = createElem('input', {
                    type: 'checkbox',
                    style: 'margin-right: 6px; accent-color: #0052A5; width: 16px; height: 16px; flex-shrink: 0;'
                });
                checkbox.checked = activeLayers.has(layer.name);
                checkbox.addEventListener('change', (e) => {
                    toggleLayer(layer, e.target.checked);
                });
     
                const label = createElem('span', {
                    textContent: layer.title,
                    style: 'user-select: none; font-size: 11px; color: #333; flex: 1; cursor: pointer;'
                });
     
                // Make label clickable for checkbox
                label.addEventListener('click', () => {
                    checkbox.checked = !checkbox.checked;
                    toggleLayer(layer, checkbox.checked);
                });
     
                // Legend button for floating panel
                const legendBtn = createElem('button', {
                    innerHTML: 'ℹ️',
                    title: 'Näytä selite',
                    style: `
                        width: 16px;
                        height: 16px;
                        padding: 0;
                        background: #f0f0f0;
                        border: 1px solid #ccc;
                        border-radius: 3px;
                        cursor: pointer;
                        font-size: 10px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: all 0.2s;
                        flex-shrink: 0;
                    `
                });
     
                legendBtn.addEventListener('mouseenter', function () {
                    this.style.background = '#e0e0e0';
                    this.style.transform = 'scale(1.1)';
                });
     
                legendBtn.addEventListener('mouseleave', function () {
                    this.style.background = '#f0f0f0';
                    this.style.transform = 'scale(1)';
                });
     
                legendBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    openLegendWindow(layer);
                });
     
                toggle.appendChild(checkbox);
                toggle.appendChild(label);
                toggle.appendChild(legendBtn);
                floatingPanel.appendChild(toggle);
            });
     
            // Info section
            const infoDiv = createElem('div', {
                style: 'margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 9px; color: #666;',
                innerHTML: '<strong>Lähde:</strong> Väylävirasto Avoin API'
            });
            floatingPanel.appendChild(infoDiv);
        }
     
        // Setup floating button drag functionality
        function setupFloatingButtonEvents(floatingPanel) {
            let isDragging = false;
            // Memory leak fix: Track handler references
            let mouseMoveHandler = null;
            let mouseUpHandler = null;
     
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
                    // Position panel relative to button
                    const buttonTop = parseInt(floatingButton.style.top) || 64;
                    floatingPanel.style.left = floatingButton.style.left;
                    floatingPanel.style.top = (buttonTop + 45) + 'px';
                    floatingPanel.style.display = 'block';
                    this.style.borderColor = '#0052A5';
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
                    // Panel follows if visible
                    if (floatingPanel.style.display === 'block') {
                        floatingPanel.style.left = floatingButton.style.left;
                        const buttonTop = parseInt(floatingButton.style.top) || 64;
                        floatingPanel.style.top = (buttonTop + 45) + 'px';
                    }
                }
     
                mouseMoveHandler = function (e) {
                    moveAt(e.pageX, e.pageY);
                };
     
                mouseUpHandler = function () {
                    document.removeEventListener('mousemove', mouseMoveHandler);
                    document.removeEventListener('mouseup', mouseUpHandler);
                    // Memory leak fix: Null out handler references
                    mouseMoveHandler = null;
                    mouseUpHandler = null;
     
                    // Save button position after dragging
                    if (isDragging) {
                        savePreferences();
                        setTimeout(() => isDragging = false, 100);
                    }
                };
     
                document.addEventListener('mousemove', mouseMoveHandler);
                document.addEventListener('mouseup', mouseUpHandler);
            });
     
            floatingButton.addEventListener('dragstart', () => false);
        }
     
        // Initialize script
        function initializeScript() {
            console.log('WME Väylävirasto: WME ready, initializing...');
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
     
        console.log('WME Väylävirasto: Script loaded');
    })();
