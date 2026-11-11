# ScoreGuard Cloud test v0.7 — postavljanje bez servera

Ova verzija pokreće Streamlit panel, scraper, naloge i raspored u istoj Streamlit Community Cloud instanci. Ne traži Docker, VPS, domen, BACKEND_URL ni PUBLIC_ORIGIN.

Pravila poređenja ostaju ista: fudbal, live i završeni mečevi, Flashscore i/ili Sofascore, trenutni rezultat i poluvreme. Povezivanje koristi klubove, datum i vreme; preveden naziv takmičenja ne blokira povezivanje. Minuti golova ne porede se.

## 1. Pripremite dva odvojena fajla

1. Programski fajlovi: na stranici ovog repozitorijuma na GitHubu izaberite `Code` → `Download ZIP`. ZIP ne sadrži naloge, lozinke, heševe operatera, tokene ni interne spiskove.
2. `cloud-secrets.toml` — konfiguracija naloga Stefan i Milos. Dobijate je zasebno od osobe koja upravlja nalozima. Sadrži heševe lozinki, ne čitljive lozinke.
3. Taj drugi fajl ostavite na svom računaru. Njegov sadržaj kopira se u Streamlit Secrets, a ne na GitHub. Početne lozinke ostaju one koje ste dobili ranije.

## 2. Raspakujte programski paket

1. Desni klik na `ScoreGuard-main.zip` → `Extract All` / `Izdvoji sve`.
2. Otvorite unutrašnju fasciklu `ScoreGuard-main`.
3. U njoj treba da vidite `streamlit_app.py`, `requirements.txt`, `CLOUD-START.md` i fascikle `cloud_runtime`, `streamlit_panel`, `auth`, `scraper` i `service`.
4. Fajl `cloud-secrets.toml` držite van ove fascikle.

## 3. Napravite GitHub repozitorijum

1. Otvorite https://github.com/ i napravite nalog ili se prijavite.
2. Kliknite `New repository` i unesite naziv, na primer `scoreguard-cloud-test`.
3. Izaberite `Private`, pa `Create repository`.
4. Izaberite `uploading an existing file` ili `Add file` → `Upload files`.
5. Prevucite sadržaj unutrašnje fascikle `ScoreGuard-main`. Prenesite i fajlove i fascikle, uz očuvanu strukturu. Ne prevlačite ZIP ili celu nadređenu fasciklu.
6. Kliknite `Commit changes`.

Na početnoj strani repozitorijuma treba odmah da se vidi `streamlit_app.py`. Ako se vidi samo jedna fascikla `ScoreGuard-main`, otvorili ste dodatni nivo; prenesite njen sadržaj na početni nivo repozitorijuma.

Skrivena fascikla `.streamlit` sadrži izgled aplikacije i primer podešavanja. Ako je sistem ne prikaže pri slanju, osnovna aplikacija će i dalje raditi sa podrazumevanim izgledom. Stvarni Secrets se uvek lepe kroz Streamlit sajt.

## 4. Postavite aplikaciju na Streamlit

1. Otvorite https://share.streamlit.io/ i povežite GitHub nalog.
2. Dozvolite Streamlitu pristup privatnom repozitorijumu koji ste napravili.
3. Kliknite `Create app`, pa `Yup, I have an app`.
4. Popunite polja prema tabeli:

| Polje | Vrednost |
|---|---|
| Repository | vaš GitHub nalog / scoreguard-cloud-test |
| Branch | main, odnosno grana na kojoj ste sačuvali fajlove |
| Main file path | streamlit_app.py |
| App URL | slobodan naziv po želji |
| Advanced settings → Python | 3.12 |

**Main file path je `streamlit_app.py` na početnom nivou.** Taj fajl pokreće i servis. Ranija putanja `streamlit_panel/streamlit_app.py` pokretala je samo panel.

## 5. Nalepite konfiguraciju naloga u Secrets

1. Dok ste na ekranu za postavljanje, kliknite `Advanced settings`.
2. Izaberite Python `3.12`.
3. Na svom računaru otvorite `cloud-secrets.toml` koji ste dobili u Notepadu / Beležnici.
4. Pritisnite `Ctrl+A`, pa `Ctrl+C` da kopirate ceo sadržaj.
5. U polje `Secrets` na Streamlit sajtu nalepite kopirani sadržaj pomoću `Ctrl+V`.
6. Kliknite `Save`, pa `Deploy`.

Ne dodajete BACKEND_URL, PUBLIC_ORIGIN, Docker fajlove ili svoju serversku adresu. Servis dobija unutrašnju adresu automatski. Primer `.streamlit/secrets.example.toml` nije konfiguracija stvarnih naloga; koristite zasebno preuzeti fajl.

Ako ste aplikaciju već objavili, otvorite `Manage app` → `Settings` → `Secrets`, nalepite konfiguraciju i sačuvajte. Po potrebi izaberite `Reboot app`.

## 6. Prva prijava i unos

1. Sačekajte instaliranje zavisnosti. Prvo pokretanje može trajati nekoliko minuta.
2. Otvorite dobijenu adresu oblika `https://vas-naziv.streamlit.app`.
3. Na vrhu treba da piše da je servis za proveru aktivan.
4. Prijavite se kao Stefan ili Milos postojećom lozinkom. Velika i mala slova korisničkog imena nisu bitna.
5. Otvorite `Uvoz mečeva`, izaberite datum prvog dana spiska i nalepite kopiju iz internog programa.
6. Kliknite `Pregledaj unos` i proverite interne šifre, domaćina/gosta, tekući rezultat i poluvreme.
7. Izaberite Flashscore, Sofascore ili oba i uključite automatsku proveru.
8. Kliknite `Uvezi mečeve`, zatim otvorite `Pregled mečeva` i kliknite `Proveri sada`.

Mečevi svakog operatera, napomene i istorija odvojeni su prema prijavljenom nalogu. Samo osvežavanje stranice može tražiti novu prijavu; ono samo po sebi ne briše spisak.

## 7. Šta proveriti tokom testa

- Ručna provera radi preko dugmeta `Proveri sada`.
- Uključena automatika proverava na 300 sekundi dok je instanca aktivna. Raspored ne zavisi od osvežavanja panela.
- Zatvaranje kartice ili odjava ne gase servis odmah. Ako Cloud uspava ili zaustavi instancu, provere prestaju.
- U `Istorija aktivnosti` vide se operater, vreme i ručna/automatska provera.
- Različit naziv takmičenja ne sprečava povezivanje istih klubova i termina.
- Nedostupan ili blokiran izvor ostaje neproveren, a ne usaglašen.

Interni spisak i dalje predstavlja kopirani snimak. Kada se interni rezultat promeni, ponovo nalepite spisak da biste poredili novu vrednost.

## 8. Ograničenja ove testne verzije

Streamlit Community Cloud prema svojoj dokumentaciji uspavljuje aplikacije posle 12 sati bez poseta. Ova verzija ne pokušava da spreči uspavljivanje. Automatski rad nije garantovan dok je instanca uspavana ili isključena.

Podaci su u lokalnom prostoru Cloud instance. Ponovno kreiranje, nova instalacija ili premeštanje instance može obrisati spiskove, istoriju, napomene i sesije. Nalozi se ponovo učitavaju iz Secrets. Važnu istoriju tokom testa preuzmite kao CSV iz panela. Običan restart internog servisa pokušava da sačuva lokalne podatke dok isti prostor postoji.

Sofascore je u razvojnom okruženju vraćao HTTP 403. Uspešan pristup sa vašeg Streamlit Cloud servera mora se proveriti. Aplikacija ne zaobilazi zaštitu i ne potvrđuje rezultate iz blokiranog izvora.

Ovo je verzija za trenutne testove. Za stalni operaterski rad i trajno čuvanje podataka koristite zasebni produkcioni servis.

## 9. Najčešći problemi

| Poruka ili simptom | Postupak |
|---|---|
| Nedostaju nalozi | U Settings → Secrets nalepite ceo zasebno dobijeni cloud-secrets.toml. |
| Servis nije pokrenut | Proverite Secrets, da je ceo ZIP prenet, main file streamlit_app.py i Python 3.12; zatim Reboot app. |
| Server za proveru nije dostupan | Sačekajte nekoliko sekundi da se servis ponovo pokrene. Ako se ponavlja, otvorite Manage app i proverite log. |
| Pokušava vezu sa api:8080 | Izabran je stari ulazni fajl. Postavite root streamlit_app.py iz Cloud paketa. |
| Pogrešno korisničko ime ili lozinka | Koristite Stefan ili Milos i ranije dodeljenu lozinku; proverite da ste preuzeli pravu konfiguraciju naloga. |
| HTTP 403 kod izvora | Izvor je odbio zahtev; to nije greška prijave operatera. Proverite drugi izvor ili sačekajte predviđenu pauzu. |
| Aplikacija spava | Otvorite je i kliknite dugme za buđenje. Potom proverite spisak i pokrenite ručnu proveru. |

## 10. Povezivanje različitih naziva klubova iz panela

Otvorite **Poveži nazive klubova** u levom meniju ili kliknite isto dugme u detaljima meča. Izaberite klub iz internog spiska ili unesite njegov naziv ručno, izaberite izvor i upišite naziv sa tog izvora. Potvrdite da je to isti klub i ista selekcija, pa kliknite **Sačuvaj povezivanje**.

Primer: interno `Victoria Utd Limbe`, Flashscore `Victoria United`. Za tu vezu više nije potrebno menjati konfiguraciju naloga ili Secrets. Datum, vreme i redosled domaćina i gosta i dalje moraju da se poklapaju.

Povezivanja se čuvaju za vaš nalog i koriste i u budućim uvozima. Posle izmene prethodni rezultat provere se poništava: kliknite **Proveri sada** ili sačekajte uključenu automatiku. Drugi operater ima sopstvenu listu povezivanja.

Na ovom ekranu možete ukloniti pogrešnu vezu, preuzeti JSON kopiju ili vratiti prethodno preuzeta povezivanja. U testnoj verziji sačuvajte kopiju pre ponovnog kreiranja aplikacije, jer lokalni podaci mogu nestati. Nalozi, lozinke i spiskovi mečeva nisu deo te JSON kopije.

## Završeni mečevi i objašnjenje provere

Interna oznaka `FT / 2nd half` može ostati i posle kraja utakmice. Ako izvor potvrdi završen meč, a rezultat i poluvreme se poklapaju, ova oznaka sama više ne izaziva crveno neslaganje. Pravilo važi i za već sačuvane uvoze iz internog programa. Nedostajući ili zastareli podaci ostaju neprovereni, a stvarne razlike u rezultatu i poluvremenu ostaju neslaganja.

Objašnjenje statusa prikazuje se u **Detaljima meča i obradi neslaganja**. Posle ažuriranja koda na GitHub-u sačekajte da Streamlit učita izmene; ako i dalje prikazuje staru verziju, izaberite **Manage app → Reboot app**, pa u aplikaciji kliknite **Proveri sada**.

Ranije dodate mape kroz `TEAM_ALIASES_JSON` ostaju aktivne. Ako postoje, ekran prikazuje obaveštenje; uklanjanje nove veze iz panela ne briše ranija pravila iz tih podešavanja.

## 11. Zvanična dokumentacija

- https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy
- https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/secrets-management
- https://docs.streamlit.io/deploy/streamlit-community-cloud/manage-your-app
