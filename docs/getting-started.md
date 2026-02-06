# Aloitusopas

## Tampermonkeyn asennus

Tampermonkey on selainlaajennus, joka mahdollistaa käyttäjäskriptien suorittamisen.

**Chrome / Edge:**
1. Avaa Chrome Web Store
2. Hae "Tampermonkey"
3. Klikkaa "Lisää Chromeen" / "Add to Chrome"
4. Vahvista asennus

**Firefox:**
1. Avaa Firefox Add-ons -sivusto
2. Hae "Tampermonkey"
3. Klikkaa "Lisää Firefoxiin"
4. Vahvista asennus

## Käyttäjäskriptin asennus GitHubista

Kun Tampermonkey on asennettu:

1. Navigoi GitHub-repositorioon, jossa skripti sijaitsee
2. Avaa haluamasi `.user.js` -tiedosto
3. Klikkaa "Raw"-painiketta tiedoston sisällön yläpuolella
4. Tampermonkey tunnistaa automaattisesti skriptin ja avaa asennusikkunan
5. Klikkaa "Install" tai "Asenna"

## Asennus Greasy Forkista

1. Mene osoitteeseen https://greasyfork.org
2. Hae haluamaasi skriptiä nimellä
3. Klikkaa skriptin sivulla vihreää "Install this script" -painiketta
4. Tampermonkey avaa asennusikkunan
5. Klikkaa "Install"

**Huomio:** Greasy Forkista asennetut skriptit päivittyvät automaattisesti, kun tekijä julkaisee uuden version. GitHub-asennukset eivät päivity automaattisesti ellei skriptissä ole määritelty `@updateURL`- tai `@downloadURL`-metatietoja.

## WME-skriptikehityksen perusteet

**Konsoliloki:**
```javascript
console.log("Tämä tulostuu selaimen konsoliin");
```

**Selaimen kehitystyökalut:**
- Chrome/Edge: Paina `F12` tai `Ctrl+Shift+I`
- Firefox: Paina `F12` tai `Ctrl+Shift+K`
- Konsoli-välilehti näyttää virheet ja console.log-tulosteet
- Network-välilehti näyttää HTTP-pyynnöt

**Skriptin uudelleenlataus:**
Kun muokkaat skriptiä, päivitä WME-sivu (`Ctrl+R` tai `F5`) nähdäksesi muutokset.