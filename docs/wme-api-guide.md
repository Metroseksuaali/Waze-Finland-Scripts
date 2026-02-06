# WME API -opas

## Kaksi API-rajapintaa

Waze Map Editorissa on kaksi eri API-rajapintaa skriptien käyttöön:

**Legacy API (vanha):**
- Suora pääsy `W.model` ja `W.map` -objekteihin
- Vakaampi ja luotettavampi tiedon lukemiseen
- Suositeltu valinta useimmissa tapauksissa

**WME SDK (uusi):**
- Modernimpi, Promise-pohjainen API
- Vaatii alustuksen `getWmeSdk()`-kutsulla

## Legacy API: Perusteet

**Segmentit (tiet):**
```javascript
const segments = W.model.segments.getObjectArray();
segments.forEach(seg => {
    console.log(seg.attributes.primaryStreetID);
    console.log(seg.attributes.roadType);
});
```

**Paikat (venues):**
```javascript
const venues = W.model.venues.getObjectArray();
venues.forEach(venue => {
    console.log(venue.attributes.name);
});
```

**Valinta:**
```javascript
const selected = W.selectionManager.getSelectedFeatures();
if (selected.length > 0) {
    const feature = selected[0];
    console.log(feature.model.type);
}
```

## Kartan rajat ja koordinaatit

**Kartan rajat (Mercator):**
```javascript
const extent = W.map.getOLMap().getExtent();
// extent = [minX, minY, maxX, maxY] Mercator-koordinaatteina
```

**Muunnos WGS84:ään:**
```javascript
function mercatorToWgs84(x, y) {
    const lon = (x / 20037508.34) * 180;
    let lat = (y / 20037508.34) * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return {lon, lat};
}
```

## Segmentin geometria

```javascript
const seg = W.model.segments.getObjectById(12345);
const geom = seg.getGeometry();

// OpenLayers-muoto: geom.components = array of {x, y}
geom.components.forEach(point => {
    const wgs = mercatorToWgs84(point.x, point.y);
    console.log(wgs.lat, wgs.lon);
});
```

**Node ID:t:**
```javascript
const fromNodeID = seg.attributes.fromNodeID;
const toNodeID = seg.attributes.toNodeID;
const fromNode = W.model.nodes.getObjectById(fromNodeID);
```

**Huomio:** Segmentin geometrian päivittäminen ei siirrä risteyssolmuja (junction nodes). Solmut on siirrettävä erikseen.

## WME SDK: Alustus

```javascript
const sdk = await window.getWmeSdk({
    scriptId: 'my-unique-script-id',
    scriptName: 'My Script Name'
});
```

## Tapahtumat (Events)

```javascript
// WME valmiina
document.addEventListener('wme-ready', () => {
    console.log('WME on valmis');
});

// Valinta muuttuu
W.selectionManager.events.register('selectionchanged', null, () => {
    console.log('Valinta muuttui');
});

// Muutos suoritettu
W.model.actionManager.events.register('afteraction', null, () => {
    console.log('Toiminto suoritettu');
});
```

## Sivupalkin välilehti

```javascript
const { tabLabel, tabPane } = W.userscripts.registerSidebarTab('my-tab');
tabLabel.textContent = 'Oma';
tabPane.innerHTML = '<h3>Oma skripti</h3>';
await W.userscripts.waitForElementConnected(tabPane);
```

## Käytännön vinkit

- **Lue dataa Legacy API:lla** - `W.model` on luotettavampi
- **Tarkista aina olemassaolo** - `if (W && W.model && W.model.segments)`
- **Käytä tapahtumia** - Älä pollaa setIntervalilla
- **Testaa konsolissa** - Kokeile komentoja ensin selaimen konsolissa