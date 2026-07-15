# WME MML-katutarkistus

Tampermonkey-lisäosa Waze Map Editorille (WME), joka vertailee näkyvien tie- ja katusegmenttien nimiä Maanmittauslaitoksen (MML) geokoodausrajapinnan tieosoiteaineistoon.

Lisäosa auttaa löytämään katuja, joita ei löydy MML:n virallisesta tieosoiteaineistosta tai jotka näyttävät kuuluvan eri kuntaan kuin WME:ssä.

> **Huom:** MML:stä puuttuva katu ei automaattisesti tarkoita virhettä Wazessa. Uudet kadut, yksityistiet tai muut erityistapaukset/ sovitut nimeämiskäytönnöt voivat olla oikein WME:ssä, vaikka niitä ei löytyisi MML:n aineistosta.

---

## Ominaisuudet

- Tarkistaa näkyvällä kartta-alueella olevat segmentit.
- Tukee ensisijaisia ja vaihtoehtoisia katujen nimiä.
- Hakee tiedot MML:n geokoodausrajapinnasta.
- Välimuisti vähentää API-kutsuja (30 päivän TTL).
- Rinnakkaiset kyselyt nopeuttavat tarkistusta.
- Korostaa ongelmalliset segmentit kartalla.
- Näyttää virhelistan WME:n sivupaneelissa.
- Markerin klikkaus:
  - näyttää ongelman kuvauksen
  - valitsee kyseisen kadun segmentit WME:ssä
- Valinnainen automaattinen tarkistus kartan liikkuessa.
- Tietyyppikohtaiset asetukset.
- Mahdollisuus raportoida havainto suoraan Maanmittauslaitokselle, mikäli epäilee virheen olevan Maanmittauslaitoksen aineistossa.

---

## Tarkistuslogiikka

Lisäosa toimii seuraavasti:

1. Lukee WME:n datamallista näkyvällä kartta-alueella olevat segmentit.
2. Suodattaa segmentit valittujen tietyyppien perusteella.
3. Kerää segmenttien kaikki katu- ja vaihtoehtoiset nimet.
4. Muodostaa uniikit `(kunta|katu)` -parit.
5. Kysyy MML:n geokoodausrajapinnasta löytyykö kyseinen katu virallisesta tieosoiteaineistosta.
6. Tallentaa tuloksen välimuistiin.
7. Korostaa segmentit, joiden yksikään nimi ei tuota osumaa.


---

## Värit kartalla

| Väri | Merkitys |
|--------|-----------|
| 🔴 Punainen | Katua ei löydy MML:n tieosoiteaineistosta |
| ⚫ Harmaa | MML-kysely epäonnistui |

Kartalle piirretään lisäksi huomiomerkki (`!`) segmentin todelliseen keskikohtaan.

---

## Tuetut tietyypit

Oletuksena tarkistetaan:

- Katu
- Pääkatu
- Valtatie (Major Highway)
- Seututie (Minor Highway)
- Maastotie / hiekkatie
- Yksityistie
- Pysäköintialueen tie
- Kuja / kapea katu

Oletuksena pois käytöstä (oletusasetuksia voi muuttaa skriptin sisältä, ei käyttöliittymästä):

- Moottoritie
- Rampit
- Jalankulkuväylät
- Kävelytiet
- Polut
- Kiitotiet

Aina ohitettavat:

- Lautat
- Portaat
- Junaradat

---

## Asennus

### 1. Tarkista

[Aloitusopas](/Waze-Finland-Scripts/blob/main/docs/getting-started.md)

### 2. Luo MML API-avain

MML:n avoimet rajapinnat:

https://www.maanmittauslaitos.fi/rajapinnat/api-avaimen-ohje

Rekisteröidy OmaTili-palveluun.
Kirjaudu palveluun rekisteröimälläsi sähköpostilla.
Kirjautumisen jälkeen voit
- luoda uuden API-avaimen,
- poistaa olemassa olevan API-avaimen.
- muokata tietojasi tai poistaa käyttäjätunnuksesi.

### 3. Asenna skripti

Luo uusi Tampermonkey-skripti ja liitä tämän projektin sisältö siihen.

### 4. Avaa Waze Map Editor

Lisäosa lisää Scripts -sivupaneeliin uuden välilehden:

**MML**

Syötä API-avain ja käynnistä tarkistus.

---

## Asetukset

### Tarkistettavat tietyypit

Voit valita, mitä tietyyppejä tarkistetaan.

Valinnat tallennetaan Tampermonkeyn paikalliseen tallennustilaan.

### Automaattitarkistus

Kun toiminto on käytössä:

- tarkistus käynnistyy kartan pysähdyttyä
- käytetään debounce-viivettä
- tarkistus suoritetaan vasta zoomitasolla 14 tai suurempi

---

## Välimuisti

Tulokset tallennetaan paikalliseen välimuistiin:

- Avain: `kaupunki|katu`
- Säilytysaika: 30 päivää

Tämän ansiosta samaa katua ei tarvitse kysyä MML:ltä uudestaan jokaisella panoroinnilla tai zoomauksella.

---

## Suorituskyky

- Vain näkyvällä kartta-alueella olevat segmentit tarkistetaan.
- Kyselyt suoritetaan rinnakkain.
- Oletusarvoisesti käytetään jopa 10 samanaikaista MML-kyselyä.
- Välimuisti vähentää merkittävästi rajapintakutsujen määrää.

---

## Tunnetut rajoitukset / ongelmat

- Rampeilla, moottorieteillä jne. voi olla nimeämiskäytäntöjä joita ei MML kartasta löydy. Muista että tämä ei välttämättä ole virhe, ja käytä asetuksissa mielekkäitä tietyyppirajoituksia rajoittaaksesi virhehavaintoja. 

---

## Screenshots
![MML API tarkistus](MML-Api-tarkistus.png)

Kun segmentin huomiomerkkiä klikataan, saman nimiset segmentit tulee valituksi ja tien päällä näytetään pop-up ruutu
![MML API tarkistus](segmentin-valinta.png)

![Maanmittauslaitoksen karttapalaute](karttapalaute.png)




## Versiohistoria
### 0.6.0
-  MML-palaute: "Ilmoita MML:lle" avaa esitäytetyn palautelomakkeen listariviltä ja markerin popupista, lähetys Aineistopalaute- rajapintaan (XML, HTTP POST, EPSG:3067; testitila oletuksena,yhteystiedot muistetaan). 
 - Uusi salmiakkimarkkeri. 
 - CC BY 4.0 -attribuutio paneeliin ja popupiin. 
 - Vain Suomessa olevat tiet tarkistetaan
### 0.5.2

- Markerit sijoitetaan segmentin todelliseen keskikohtaan viivaa pitkin.

### 0.5.1

- Markerin klikkaus valitsee segmentit WME:ssä.

### 0.5.0

- Samanaikaiset kyselyt nostettu 10:een.
- MML-kutsuihin lisätty Client-ID.
- Markerin popup-ikkuna.
- Käynnissä-indikaattori kartan päälle.

### 0.4.2

- Ympyrämarkkeri segmentin keskikohtaan.

### 0.4.1

- Uniikki vikalista katu+kunta -tasolla.
- Usean segmentin käsittely samalla kadulla.

### 0.4.0

- Uudistettu asetusvalikko.
- Automaattitarkistus.
- Zoomirajoitus ja debounce.

### 0.3.1

- Lautat ja portaat poistettu tarkistuksesta.

### 0.3.0

- Tietyyppiasetukset.
- Junaradat aina pois tarkistuksesta.

### 0.2.1

- Näkyvien segmenttien suodatus.

### 0.2.0

- Rinnakkaiset kyselyt.
- Ruotsinkielinen kuntanimi huomioidaan.

### 0.1.0

- Ensimmäinen julkaisu.

---

## Lisenssi

MIT License
