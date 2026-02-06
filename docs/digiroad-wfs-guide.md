# Digiroad ja Väylä WFS/WMS -opas

## Yleistä

Väylävirasto tarjoaa avointa liikenneinfrastruktuuridataa Digiroad-järjestelmän kautta. Data on saatavilla WFS (Web Feature Service) ja WMS (Web Map Service) -rajapinnoilla.

## WFS-rajapinta

**Päätepiste:**
```
https://avoinapi.vaylapilvi.fi/vaylatiedot/digiroad/wfs
```

**Tärkeät huomiot:**
- Koordinaatit ovat EPSG:3067-muodossa (ETRS-TM35FIN)
- WME käyttää WGS84-koordinaatteja (EPSG:4326)
- Koordinaattimuunnos on välttämätön

## WMS-rajapinta

**Päätepiste:**
```
https://avoinapi.vaylapilvi.fi/vaylatiedot/wms
```

## Koordinaattimuunnos

**ETRS-TM35FIN (EPSG:3067) → WGS84:**
```javascript
function wgs84ToEtrs89(lon, lat) {
    const proj4 = window.proj4;
    const etrs89 = '+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
    const [easting, northing] = proj4(wgs84, etrs89, [lon, lat]);
    return {easting, northing};
}
```

## Yleisimmät tasot

| Taso | Kuvaus |
|------|--------|
| `digiroad:dr_nopeusrajoitus` | Nopeusrajoitukset |
| `digiroad:dr_tielinkki_tielinkin_tyyppi` | Tielinkit ja tietyypit |
| `digiroad:dr_liikennemerkit` | Liikennemerkit |
| `digiroad:dr_leveys` | Tien leveys |
| `digiroad:dr_talvinopeusrajoitus` | Talvinopeusrajoitukset |

## WFS GetFeature -esimerkki

```javascript
const sw = wgs84ToEtrs89(minLon, minLat);
const ne = wgs84ToEtrs89(maxLon, maxLat);
const srsName = 'urn:ogc:def:crs:EPSG::3067';

const url = 'https://avoinapi.vaylapilvi.fi/vaylatiedot/digiroad/wfs' +
    '?service=WFS' +
    '&version=2.0.0' +
    '&request=GetFeature' +
    '&typeNames=digiroad:dr_tielinkki_tielinkin_tyyppi' +
    '&srsName=' + srsName +
    '&bbox=' + sw.easting + ',' + sw.northing + ',' +
               ne.easting + ',' + ne.northing + ',' + srsName +
    '&outputFormat=application/json';

GM_xmlhttpRequest({
    method: 'GET',
    url: url,
    onload: function(response) {
        const data = JSON.parse(response.responseText);
        console.log('Features:', data.features.length);
    }
});
```

**Huomio BBOX-syntaksista:** BBOX-parametrissa on ilmoitettava koordinaattijärjestelmä:
```
&bbox=minE,minN,maxE,maxN,urn:ogc:def:crs:EPSG::3067
```

## WMS-tason lisääminen WME:hen

```javascript
const wmsLayer = new OpenLayers.Layer.WMS(
    "Nopeusrajoitukset",
    "https://avoinapi.vaylapilvi.fi/vaylatiedot/wms",
    {
        layers: 'digiroad:dr_nopeusrajoitus',
        format: 'image/png',
        transparent: true
    },
    {
        isBaseLayer: false,
        opacity: 0.7,
        visibility: true
    }
);
W.map.getOLMap().addLayer(wmsLayer);
```

## Cross-Origin-pyynnöt

WFS-kyselyt vaativat `GM_xmlhttpRequest`-funktion. Lisää skriptin headeriin:
```
// @grant GM_xmlhttpRequest
// @connect avoinapi.vaylapilvi.fi
```

## Käytännön vinkit

- Rajaa BBOX-kyselyt pieneen alueeseen
- Digiroad-tiet voivat olla 20-200 metriä eri kohdassa kuin Waze-tiet
- Testaa WFS-kyselyt ensin selaimessa suoraan
- Käytä `maxFeatures`-parametria tulosten rajoittamiseen