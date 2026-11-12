# Razvoj i provere

Za lokalne razvojne provere koristite Node.js 24 i Python 3.12 u virtuelnom okruženju.
U Streamlit Cloudu aplikacija se i dalje pokreće preko `streamlit_app.py`.
Razvojni alati nisu potrebni operaterima niti menjaju Streamlit Secrets.

## Instaliranje razvojnih alata

```sh
npm ci
python -m pip install -r requirements-dev.txt
```

Prettier je zaključan u `package-lock.json`. Ruff je zaključan u `requirements-dev.txt`.
Streamlit instalira samo `requirements.txt`; razvojni alati su odvojeni od rada aplikacije.

## Formatiranje

```sh
npm run format
npm run format:check
```

Prettier formatira JavaScript, JSON, CSS, HTML, Markdown i podržane konfiguracione fajlove.
Ruff formatira Python. `.editorconfig` definiše osnovna pravila uvlačenja i krajeve redova.
Generisani fajlovi u `dist/`, HTML uputstva, zabeleženi odgovori izvora i privatni podaci su izuzeti.

## Testovi

```sh
npm test
npm run test:python
npm run check
```

Node testovi koriste standardni `node:test`. Python testovi koriste `unittest` i Streamlit AppTest.
Testovi sami prave privremene naloge i podatke; ne zahtevaju stvarne operaterske lozinke ili pristup internom programu.
Zahtevi prema izvorima u testovima koriste zabeležene javne odgovore ili kontrolisane adaptere.

Cloud ZIP i javni GitHub repozitorijum uključuju testove povezivanja, oba izvora,
autorizovanog lokalnog servisa, intervala, izolacije operatera i Streamlit prikaza.
Puni izvorni paket sadrži i testove Sites pakovanja i interfejsa; on se gradi komandom `npm run build`.

## Pravila koja pokrivaju regresioni testovi

- Samostalno slovo `F` u nazivu kluba ne označava žensku ekipu.
- Izričito sačuvana ekvivalencija naziva ima prednost nad heuristikom uzrasta, ženskog ili rezervnog tima.
  To važi i kada je drugi klub povezan približnim nazivom. Veza za jedan izvor ne prenosi se na drugi izvor.
- Bez takve ekvivalencije različite selekcije ostaju odvojene. Datum, vreme, redosled klubova i višeznačnost se uvek proveravaju.
- Kandidati iz indeksa domaćina, gosta i termina spajaju se kroz `Set`. Isti događaj u više indeksa razmatra se jednom;
  različiti zapisi istog para ostaju razlog za ručnu proveru.
- Oba kluba moraju zasebno dostići 80% sličnosti. Bliski kandidati se ne biraju proizvoljno.
- Provera identiteta ne potiskuje neslaganje rezultata, nedostajuće poluvreme ili zastarele podatke.
- Cloud stil se postavlja pre obaveštenja, sa većim razmakom ispod alatne trake i dodatnim razmakom na uskom ekranu.
- `requestTimeout` Node servisa iznosi 90 sekundi i odnosi se na prijem zahteva. Python klijent ima 5 sekundi za povezivanje
  i 90 sekundi za čitanje odgovora; ručna provera iz Sites panela takođe ima rok od 90 sekundi.
  Pojedinačni zahtevi prema javnim izvorima zadržavaju svoj kraći rok. Interval provere ostaje 300 sekundi.

## Provera neuspelog uparivanja i prekida odgovora

Regresioni testovi proveravaju da neuspešno tačno uparivanje nastavlja pretragu punog skupa kandidata, da se selekcija poredi nakon primene alijasa i da brisanje povezivanja vraća samo aktivne izvore. Prekid stream-a daje klasifikovan TIMEOUT ili NETWORK; nepotpun odgovor ne postaje rezultat. Poznati SourceError kodovi i ograničenje veličine odgovora ostaju sačuvani, a čitač se oslobađa.

Test ponovnog traženja koristi Node ESM mock u izdvojenom procesu sa zastavicom `--experimental-test-module-mocks`. Ta zastavica koristi se samo tokom testa; rad servisa je ne zahteva.

Kompajliranje alijasa zadržava čitljiv ciljni naziv, uz normalizovane ključeve za pretragu. Time se pri proveri kategorije čuvaju granice reči u oznakama poput U19, Women i II.
