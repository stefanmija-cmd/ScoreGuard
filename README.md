# ScoreGuard Cloud test v0.7 — postavljanje bez servera

Ova verzija pokreće Streamlit panel, scraper, naloge i raspored u istoj Streamlit Community Cloud instanci. Ne traži Docker, VPS, domen, BACKEND_URL ni PUBLIC_ORIGIN.

Pravila poređenja: fudbal, live i završeni mečevi, trenutni rezultat i poluvreme. Izvori su Flashscore, Futbol24 i opcioni API-Football. Povezivanje koristi klubove, datum i vreme; preveden naziv takmičenja ne blokira povezivanje. Minuti golova ne porede se. Interni program se koristi isključivo ručnim kopiranjem spiska.

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
7. Izaberite Flashscore, Futbol24 ili oba izvora i uključite automatsku proveru. API-Football ostaje dodatna opcija koja zahteva zaseban ključ i odgovarajući plan.
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

Futbol24 je provereno dostupan iz razvojnog okruženja za live i završene mečeve. Dostupnost sa vaše Streamlit instance prikazuje sama aplikacija. Ako izvor odbije pristup, vrati zastarele podatke ili ne pruži neophodan rezultat, podatak ostaje neproveren.

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

## 12. Više operatera i veliki spiskovi

Dozvoljeno je do 1.000 utakmica po operateru. Tabela prikazuje do 100 po strani, a provera obuhvata ceo spisak. Svaki operater ima svoj interni unos. Rezultati izvora preuzimaju se zajednički po izvoru i datumu i koriste za poređenje svih spiskova. Uobičajeni interval je 300 sekundi. Ručni zahtevi unutar 15 sekundi dele poslednje preuzimanje; njegovo vreme se ne podmlađuje. Poštuju se i starost odgovora samog izvora, blokade i kvote.

Nova stranica **Zajednička neslaganja** omogućava preuzimanje, oslobađanje i zatvaranje slučaja sa napomenom. Istovremeno preuzimanje istog slučaja dobija samo jednog operatera. Obrada ne menja utvrđeno neslaganje. Nova različita razlika može ponovo otvoriti slučaj. Administrator može objaviti potvrđene nazive klubova za sve operatere; ostali imaju i lična povezivanja.

Za postojeća dva naloga nije potrebno menjati Secrets. Dodatni stvarni nalozi nisu automatski kreirani: za njih su potrebna odabrana korisnička imena i generisana konfiguracija naloga. Test opterećenja koristi izmišljene operatere i kontrolisane rezultate. On proverava algoritam i zajedničko preuzimanje, bez garancije da Community Cloud može trajno opslužiti 12 aktivnih Streamlit sesija i sve stvarne zahteve.

## 13. Rezervna kopija u trenutnom testu

Otvorite **Podešavanja → Pripremi rezervnu kopiju → Preuzmi rezervnu kopiju**. JSON čuva sopstveni spisak, povezivanja, napomene i istoriju promena. Administratorska kopija uključuje zajednička povezivanja. Ne čuva naloge, lozinke, sesije ili API ključeve.

Vraćanje kopije pauzira automatiku i poništava poslednju potvrdu izvora; potrebna je nova provera. Vraćena istorija i napomene su označene. Slučajevi i zaduženja drugih operatera ne prepisuju se ličnom kopijom. Testna istorija čuva najviše 2.000 promena po operateru, do 14 dana, a detalji prikazuju poslednjih 50 promena izabranog meča. Zatvoreni zajednički slučajevi uklanjaju se nakon 14 dana bez aktivnosti.

## 14. Opciona trajna baza za Streamlit test

Lokalni fajlovi u Community Cloudu nisu trajno skladište, čak ni kada koristite SQLite. Zvanično objašnjenje: https://docs.streamlit.io/develop/concepts/connections/connecting-to-data . Bez podešene spoljne baze koristite rezervne kopije i postojeći test; nije pripremljen novi paket za plaćeni server.

Dodata je opcija korišćenja zasebne Supabase baze. Otvaranje naloga i povezivanje nisu urađeni automatski. Ako želite da uključite bazu:

1. U svom Supabase nalogu napravite projekat i proverite uslove i kvote izabranog plana. Nije potrebno kupovati server ili menjati Streamlit hosting.
2. U njegovom **SQL Editor** otvorite novi upit, kopirajte sadržaj `service/storage-schema.sql` iz ovog repozitorijuma i kliknite **Run**. Tabela nema pristup za anonimne korisnike.
3. Pronađite URL projekta i serverski `service_role` ključ. Ključ ne šaljite u razgovoru i ne stavljajte ga u repozitorijum.
4. U postojeći Streamlit **Settings → Secrets**, ispod postojeće konfiguracije naloga, dodajte:

```toml
SCOREGUARD_STORAGE_URL = "https://VAS-PROJEKAT.supabase.co"
SCOREGUARD_STORAGE_KEY = "VAS_SERVER_SERVICE_ROLE_KLJUC"
SCOREGUARD_STORAGE_NAMESPACE = "scoreguard-test"
```

5. Sačuvajte Secrets i ponovo pokrenite aplikaciju. Ako je baza dostupna i pravilno podešena, postojeći lokalni podaci prenose se samo u dokumente koji još ne postoje u bazi. Postojeći podaci baze imaju prednost. Pre ovog koraka preuzmite rezervne kopije.
6. U **Podešavanjima** proverite da piše da je povezana spoljna baza. Ako je navedena baza nedostupna, aplikacija prijavljuje problem; ne prelazi prećutno na odvojenu lokalnu kopiju.

Baza čuva spiskove, provere, napomene, povezivanja, zajedničke slučajeve i istoriju. Nalozi i pristupni ključevi ostaju u Secrets, a korisnici se nakon nove instance ponovo prijavljuju. Uspavljivanje Streamlita i dalje prekida provere. Podržan je jedan aktivni servis po ovom prostoru baze; kontrola revizija odbija upis druge nezavisne instance. Za dva odvojena testa koristite različite namespace vrednosti. Isključivanje baze vraća rad na lokalno skladište, pa prethodno izvezite podatke koje želite da zadržite.

## 15. Opcioni API-Football kao dodatni izvor

Priključak koristi dokumentovani API dobavljača: https://www.api-football.com/documentation-v3 . To je zaseban opcioni izvor i ne menja izabrani izvor bez vašeg izbora.

Pre aktiviranja proverite plan, sezone i pokrivenost vaših takmičenja, uključujući poluvreme i live podatke. Dobavljač za besplatni plan u 2026. navodi sezone 2022–2024; takav plan nije rešenje za današnje utakmice: https://www.api-football.com/news/post/how-to-get-all-data-from-a-league-with-api-football . Besplatnih 100 zahteva dnevno takođe nije dovoljno za proveru tokom celog dana na pet minuta: samo jedan datum traži 288 zahteva dnevno, a više datuma povećava broj. Izvori i ograničenja: https://www.api-football.com/pricing . Cene i uslove proverite na sajtu pre pretplate.

Ako već imate odgovarajući nalog i direktan API-SPORTS ključ, dodajte ga u postojeći Streamlit Secrets:

```toml
APIFOOTBALL_KEY = "VAS_DIREKTNI_API_SPORTS_KLJUC"
APIFOOTBALL_DAILY_LIMIT = 90
```

Limit od 90 je namerno oprezan za kratke probe. Povećajte ga samo prema svom planu; ne pretpostavlja se da imate plaćenu pretplatu. Ključ se šalje samo u serverskom zaglavlju na `v3.football.api-sports.io`. RapidAPI ključ koristi drugi režim i nije podržan ovim priključkom. Posle ponovnog pokretanja izaberite **API-Football** u aplikaciji i pokrenite proveru. Bez ključa izvor ostaje jasno neproveren. Uspešan pristup stvarnom API-Football nalogu nije potvrđen u ovoj isporuci, jer ključ nije dostavljen.

Osnovni test sada koristi Flashscore i Futbol24, uz ručni interni unos. Za njih nije potreban API-Football ključ.

## 16. Zamena Sofascore-a izvorom Futbol24

Aktivni izvori su sada Flashscore (`flash`), Futbol24 (`f24`) i opcioni API-Football (`api`). Futbol24 koristi javne odgovore koje učitava njegov sajt; ovo nije zvanično ugovoreni API dobavljača. Poseban ključ za njega nije potreban. U razvojnoj proveri 12. novembra 2026. potvrđeni su live i završeni mečevi, rezultati poluvremena i oba ranija U19 primera: Austria – Belarus 0:1 (0:0) i France – Norway 6:0 (3:0). Izvor: https://www.futbol24.com/ . Dostupnost iz same korisničke Streamlit instance još treba proveriti.

Posle ažuriranja GitHub koda kliknite **Manage app → Reboot app**, pa **Proveri sada**. Ranije sačuvan izbor Sofascore-a automatski postaje Futbol24. Stari rezultati i njihove potvrde se ne prenose na novi izvor. Spiskovi, vreme internog unosa, napomene i zaduženja ostaju sačuvani u okviru postojećeg skladišta. Ovo ne menja ograničenje privremenih lokalnih podataka na Community Cloudu.

Povezivanja sa `source: "sofa"` ostaju arhivirana i nisu aktivna za Futbol24. Potvrdite njegova imena klubova kroz predloge ili stranicu povezivanja. Povezivanja za sve izvore ostaju aktivna. Isto važi za ručno podešenu mapu `TEAM_ALIASES_JSON`: stari odeljak `sofa` se ne koristi kao Futbol24 mapa; njegov odeljak je `f24`. Nije potrebno menjati konfiguraciju naloga. Stare rezervne kopije mogu se vratiti: izbor izvora se prilagođava, stari podaci ne potvrđuju novi izvor, a istorija ostaje označena kao arhiva.

Za tekući i prethodni dan koriste se javni dnevni prikazi, a za druge datume prikaz za izabrani datum. Kalendarski dan se računa u Europe/Belgrade, uz promenu letnjeg i zimskog vremena i filtriranje stvarnog vremena početka. Odgovor za pogrešan datum se ne prihvata. Dodatni datirani zahtev dozvoljen je samo ako uspešan dnevni odgovor zahvati susedni dan; blokada, HTTP 403/429, CAPTCHA i zastarelost ne pokreću pokušaje preko alternativnih domaćina.

Običan FT rezultat i poluvreme čitaju se odvojeno. Futbol24 AET zapis sa dva para u dodatnom rezultatu izdvaja poluvreme i regularnih 90 minuta. Zapis `p.x-y` predstavlja penale i ne koristi se kao poluvreme ili pretpostavljeni rezultat za 90 minuta. Nedostajući regularni rezultat, „FT Only“, nepoznati statusi i službeni ishodi ne potvrđuju rezultat. Sama dostupnost sajta nije potvrda svakog pojedinačnog meča.
