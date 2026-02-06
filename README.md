# Waze Finland Scripts

**English:** A collection of userscripts for the Waze Map Editor (WME), developed by and for the Finnish Waze editing community. These scripts add essential quality control tools, official road data layers, and workflow enhancements to improve map editing efficiency and accuracy in Finland.

---

**Suomeksi:** Kokoelma käyttäjäskriptejä Waze Map Editoriin (WME), jotka on kehitetty suomalaisen Waze-muokkaajien yhteisön tarpeisiin. Skriptit tarjoavat laadunvalvontatyökaluja, virallisia tietolähteitä Väylävirastolta ja työnkulun tehostuksia kartan muokkaamiseen Suomessa.

## Skriptit

### WME Polygon Validator
**Versio:** 1.1.0 | **Tekijä:** Metroseksuaali

Reaaliaikainen varoitusjärjestelmä, joka havaitsee virheelliset (itseään leikkaavat) polygonit WME:ssä muokkaamisen aikana. Skripti käyttää turf.js-kirjastoa geometrian validointiin ja näyttää punaiset merkit leikkauspisteiden kohdalla.

**Greasy Fork:** https://greasyfork.org/fi/scripts/565403-wme-polygon-validator

### WME Väylävirasto
**Versio:** 2.1.1 | **Tekijä:** Stemmi

Tuo Suomen Väyläviraston viralliset WMS-karttatasot WME:hen. Sisältää yli 100 virallista karttatasoa mukaan lukien nopeusrajoitukset, tietyypit, liikennemäärät ja paljon muuta. Skripti tarjoaa kelluvan paneelin ja sivupalkkiintegraation nopeaan käyttöön.

**Greasy Fork:** https://greasyfork.org/fi/scripts/553221-wme-vaylavirasto

### WME Recent Edits Extractor
**Versio:** 0.2.0 | **Tekijä:** Stemmi

Poimii sijaintitiedot Wazen "Recent Edits" -sivulta ja mahdollistaa niiden viemisen GeoJSON-, KML- tai GPX-muodossa. Tarjoaa säädettävät latausstrategiat ja koordinaattijärjestelmävaihtoehdot.

**Greasy Fork:** https://greasyfork.org/fi/scripts/557977-wme-recent-edits-extractor

## Asennus

Skriptien käyttö vaatii käyttäjäskriptilaajennuksen kuten Tampermonkey. Yksityiskohtaiset asennusohjeet löytyvät dokumentaatiosta:

**[Aloitusopas](docs/getting-started.md)**

Pika-asennus:
1. Asenna [Tampermonkey](https://www.tampermonkey.net/) selaimeesi
2. Klikkaa haluamasi skriptin Greasy Fork -linkkiä yllä
3. Paina "Install this script"

## Kontribuutio

Yhteisön kontribuutiot ovat tervetulleita! Voit osallistua:

- Raportoimalla bugeja tai ehdottamalla uusia ominaisuuksia [Issues](https://github.com/Metroseksuaali/Waze-Finland-Scripts/issues) -osiossa
- Lähettämällä pull requesteja parannusehdotuksista tai uusista skripteistä
- Jakamalla palautetta ja käyttökokemuksia [Waze Finland Discordissa](https://discord.gg/8SAVDDT7RU)


## Kiitokset
[Stemmi90](https://github.com/Stemmi90)
