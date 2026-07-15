# Waze Finland Scripts

**English:** A collection of userscripts for the Waze Map Editor (WME), developed by and for the Finnish Waze editing community. These scripts add essential quality control tools, official road data layers, and workflow enhancements to improve map editing efficiency and accuracy in Finland.

---

**Suomeksi:** Kokoelma käyttäjäskriptejä Waze Map Editoriin (WME), jotka on kehitetty suomalaisen Waze-muokkaajien yhteisön tarpeisiin. Skriptit tarjoavat laadunvalvontatyökaluja, virallisia tietolähteitä Väylävirastolta ja työnkulun tehostuksia kartan muokkaamiseen Suomessa.

## Skriptit

### WME Polygon Validator
**Versio:** 1.1.0 | **Tekijä:** Metroseksuaali

Reaaliaikainen varoitusjärjestelmä, joka havaitsee virheelliset (itseään leikkaavat) polygonit WME:ssä muokkaamisen aikana. Skripti käyttää turf.js-kirjastoa geometrian validointiin ja näyttää punaiset merkit leikkauspisteiden kohdalla.

**Greasy Fork:** https://greasyfork.org/fi/scripts/565403-wme-polygon-validator

---

### WME Väylävirasto
**Versio:** 2.1.1 | **Tekijä:** Stemmi

Tuo Suomen Väyläviraston viralliset WMS-karttatasot WME:hen. Sisältää yli 100 virallista karttatasoa mukaan lukien nopeusrajoitukset, tietyypit, liikennemäärät ja paljon muuta. Skripti tarjoaa kelluvan paneelin ja sivupalkkiintegraation nopeaan käyttöön.

**Greasy Fork:** https://greasyfork.org/fi/scripts/553221-wme-vaylavirasto
**GitHub:** https://github.com/Stemmi90/WME-Vaylavirasto

---

### WME Recent Edits Extractor
**Versio:** 0.3.0 | **Tekijä:** Stemmi

Poimii sijaintitiedot Wazen "Recent Edits" -sivulta ja mahdollistaa niiden viemisen GeoJSON-, KML- tai GPX-muodossa. Tarjoaa säädettävät latausstrategiat ja koordinaattijärjestelmävaihtoehdot.

**Greasy Fork:** https://greasyfork.org/fi/scripts/557977-wme-recent-edits-extractor

---

### WME Suomi-kartat
**Versio:** 0.3.5 | **Tekijä:** Stemmi

Lisää WME:hen karttatasojen overlay-toiminnon, jossa mukana Google Maps, OpenStreetMap, Waze Live Map ja Google Traffic -tasot säädettävällä läpinäkyvyydellä. Lisäksi tarjoaa pikavalintapainikkeet, joilla voit avata nykyisen karttanäkymän suoraan Paikkatietoikkunassa, Fintrafficissa, Maanmittauslaitoksella, Vanhoissa kartoissa ja Väylän sivuilla.

**Tiedosto:** [`scripts/WME Suomi-kartat.js`](scripts/WME%20Suomi-kartat.js)

---

### WME INSPIRE Maanmittauslaitos
**Versio:** 1.0.1 | **Tekijä:** Stemmi

Tuo Maanmittauslaitoksen INSPIRE WMS-karttatasot WME:hen. Hakee automaattisesti saatavilla olevat tasot (Administrative Units, Geographical Names, Buildings) ja tarjoaa sivupalkki-integraation sekä kelluvan pika-aktivointipaneelin tasojen hallintaan.

**Tiedosto:** [`scripts/WME_INSPIRE_Maanmittauslaitos_1.0.1.js`](scripts/WME_INSPIRE_Maanmittauslaitos_1.0.1.js)

---

### WME Koulualueet
**Versio:** 0.3.5 | **Tekijä:** Stemmi

Näyttää Suomen koulujen sijainnit kartalla Tilastokeskuksen INSPIRE OGC API:n tiedoista. Skripti tukee koulutyyppien suodatusta (peruskoulut, lukiot, erityiskoulut, ammatilliset oppilaitokset, ammattikorkeakoulut, yliopistot), näyttää koulujen nimet sekä piirtää säädettävän kokoiset koulualueet ympyröinä. Sisältää kelluvan paneelin asetusten hallintaan.

**Tiedosto:** [`scripts/WME_Koulualueet.js`](scripts/WME_Koulualueet.js)

---

### Koordinaattietsin
**Tekijä:** Stemmi

HTML-työkalu, joka analysoi XLSM/XLSX-tiedostoja ja etsii niistä koordinaatteja. Laskee etäisyydet annettuun vertailupisteeseen, näyttää tulokset suodatettavassa taulukossa ja mahdollistaa viennin KML-muotoon. Suunniteltu Digiroad-aineiston käsittelyyn toiminnallisten luokkien ja toimenpiteiden suodatuksella.

**Tiedosto:** [`scripts/Koordinaattietsin.html`](scripts/Koordinaattietsin.html)

---

### WME MML-katutarkistus
**Versio:** 0.5.2 | **Tekijä:** [Sam (samisepp)](https://github.com/samisepp)

Vertaa näkyvien tie- ja katusegmenttien nimiä Maanmittauslaitoksen (MML) geokoodausrajapinnan tieosoiteaineistoon ja korostaa segmentit, joiden katua ei löydy virallisesta aineistosta tai jotka näyttävät kuuluvan eri kuntaan. Auttaa löytämään esimerkiksi keksittyjä tai poistuneita tiennimiä. Vaatii MML:n API-avaimen. Sisältää välimuistin, rinnakkaiset kyselyt sekä valinnaisen automaattitarkistuksen kartan liikkuessa. Mahdollisuus lähettää karttapalaute Maanmittauslaitokselle mikäli epäilee tilannetta että virhe on Maanmittauslaitoksen aineistossa.

**Tiedosto:** [`scripts/mml-katutarkistus/WME MML-katutarkistus.js`](scripts/mml-katutarkistus/wme-mml-katutarkistus.user.js)
**Ohjeet:** [scripts/mml-katutarkistus/README.md](scripts/mml-katutarkistus/README.md)

---

### WME RPP Visualizer
**Versio:** 1.1.0 | **Tekijä:** [RucaDestiny(maeklund86)](https://github.com/maeklund86)

Näyttää katunumerot, sisäänkäyntipisteet ja yhdysviivat Residential Point Placeille (RPP) WME-kartalla.

**Greasy fork**: https://greasyfork.org/en/scripts/586509-wme-rpp-visualizer
**GitHub:** https://github.com/maeklund86/wme_rpp_visualizer

## Asennus

Skriptien käyttö vaatii käyttäjäskriptilaajennuksen. Yksityiskohtaiset asennusohjeet löytyvät dokumentaatiosta:

**[Aloitusopas](docs/getting-started.md)**

Pika-asennus:
1. Asenna jokin seuraavista käyttäjäskriptilaajennuksista selaimeesi:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari, Opera)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox, Edge)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)
2. Klikkaa haluamasi skriptin Greasy Fork -linkkiä yllä
3. Paina "Install this script"

## Kontribuutio

Yhteisön kontribuutiot ovat tervetulleita! Voit osallistua:

- Raportoimalla bugeja tai ehdottamalla uusia ominaisuuksia [Issues](https://github.com/Metroseksuaali/Waze-Finland-Scripts/issues) -osiossa
- Lähettämällä pull requesteja parannusehdotuksista tai uusista skripteistä
- Jakamalla palautetta ja käyttökokemuksia [Waze Finland Discordissa](https://discord.gg/8SAVDDT7RU)


## Kiitokset
Kiitos kaikille suomalaisen Waze-yhteisön vapaaehtoisille, jotka ovat jakaneet skriptejään ja työkalujaan tähän kokoelmaan:

- [Stemmi90](https://github.com/Stemmi90)
- [samisepp](https://github.com/samisepp)
