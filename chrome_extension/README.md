# ScoreGuard Chrome dodatak — početni test

Aktuelna verzija je **0.1.5**. Kolona **Score 2** je rezultat poluvremena, a odvojene **Home / Away** kolone uz FT/HT su trenutni rezultat.

Dodatak čita samo već učitane fudbalske redove iz izabranog Backoffice taba. Ne poziva Backoffice API, ne osvežava stranicu, ne klikće po njoj i ne prelistava stranice. Čitanje DOM tabele ima mali lokalni trošak u pregledaču; ne stvara dodatne HTTP zahteve internom sistemu.

## Postavljanje

1. U ScoreGuard-u se prijavi svojim nalogom i otvori **Chrome uvoz**.
2. Klikni **Preuzmi Chrome dodatak**. Desni klik na ZIP → **Extract all / Izdvoji sve**. Sačuvaj raspakovanu fasciklu.
3. U Chrome adresu upiši `chrome://extensions` i pritisni Enter.
4. Uključi **Developer mode / Režim za programere** u gornjem desnom uglu.
5. Klikni **Load unpacked / Učitaj raspakovano** i izaberi fasciklu u kojoj je `manifest.json`.
6. Klikni ikonicu slagalice pored adrese i zakači ScoreGuard dodatak za lakši pristup.

## Povezivanje dva taba

1. Otvori Backoffice, prijavi se uobičajeno i otvori tabelu fudbalskih mečeva koju želiš da pratiš.
2. Klikni dodatak → **Ovaj tab je Backoffice**. Odobri pristup tom konkretnom sajtu kada Chrome pita.
3. Pređi na tab sa prijavljenim Streamlit ScoreGuard-om. Klikni dodatak → **Ovaj tab je ScoreGuard** i odobri pristup tom sajtu.
4. Klikni **Pročitaj sada** u dodatku. Treba da se pojavi broj učitanih mečeva.
5. U ScoreGuard levom meniju uključi **Primaj iz Chrome dodatka**. Otvori **Chrome uvoz**.
6. Podesi **Datum prvog dana Chrome spiska** da odgovara oznaci dana u Backoffice tabeli. Pregledaj šifre, klubove, rezultate i broj mečeva.
7. Izaberi izvore i klikni **Potvrdi povezivanje i uvezi**. Mečevi su zatim dostupni u **Pregledu mečeva**.

Lozinke ostaju u prijavama tih aplikacija. U dodatak se ne unose nalozi ni API ključevi. Svaki operater koristi svoj Chrome profil i svoj ScoreGuard nalog. Povezan je konkretan tab, ne svi tabovi tog sajta.

## Automatski i ručni rad

Za automatski rad uključi **Čitaj tabelu na svakih 5 minuta** u dodatku i, prilikom potvrde prvog spiska, **Automatski uvozi naredne promene ovog spiska** u ScoreGuard-u. Uključi i provere izvora. Novi prihvaćeni uvoz odmah pokreće zajedničku proveru izabranih izvora, uključujući Flashscore i Futbol24, i kada se rezultat nije promenio. Ne čeka se drugi petominutni tajmer. Podaci se prikazuju po završetku te provere; nedostupan izvor ostaje neproveren.

Za trenutni zajednički ciklus klikni **Preuzmi iz Backoffice taba**. **Proveri sada** u pregledu i dalje pokreće zasebnu ručnu proveru izvora. Ako nema novog uvoza, usklađeni režim čeka sledeće čitanje. Promena skupa mečeva, pauziran prijem, zatvoren tab, odjava ili uspavan računar prekidaju nove automatske cikluse.

Promena rezultata ili perioda istih mečeva može da se uveze automatski. Promena skupa mečeva, datuma, timova ili vremena početka pauzira automatski uvoz i zahteva novi pregled. Time se izbegava zamena celog spiska jednom stranicom nakon prelistavanja ili filtriranja. Svako uspešno novo čitanje osvežava vreme internog unosa i kada su rezultati isti. Ponovljeno prikazivanje istog prenosa ne predstavlja novo čitanje.

Ostavi oba taba otvorena u istom Chrome profilu. Backoffice sam mora da ažurira svoju stranicu; dodatak ne zna koliko su podaci na toj stranici sveži u odnosu na interni server. Čitaju se samo redovi koje je stranica stvarno učitala. Sakriveni, neprelistani i virtuelizovani redovi nisu obuhvaćeni.

Posle odjave iz ScoreGuard-a potrebno je ponovo omogućiti prijem i potvrditi povezivanje. Zatvoren Backoffice tab, navigacija na drugu stranicu, ugašen pregledač, uspavan računar ili uspavan Streamlit prekidaju prenos. Ako ponovo otvoriš tab, poveži ga u dodatku. **Prekini povezivanje** zaustavlja dodatak i briše njegov privremeni snimak; postojeći ScoreGuard spisak ostaje.

## Ako tabela nije prepoznata

Početni adapter očekuje HTML tabelu ili redove sa `role="row"` i `role="gridcell"`, sa kolonama koje ste dostavili: F, takmičenje, šifra, domaćin, gost, dan/vreme, FT/HT, dva broja rezultata, poluvreme, minut i period.

Ako postoji više tabela, u polje **Selektor tabele** unesi selektor konkretnog spiska, npr. `#matches-table`, pa ponovo klikni **Ovaj tab je Backoffice**. To je tehnička postavka koja zavisi od stvarne Backoffice stranice. Ne biraj `body` niti celu stranicu. Ako stranica koristi drugačiji raspored, iframe ili posebnu komponentu, adapter treba prilagoditi njenoj strukturi; greška čitanja ne briše prethodni ScoreGuard spisak.

## Podaci i dozvole

Dodatak traži pristup samo sajtovima koje povežeš. Lokalno čuva njihove adrese bez parametara, selektor i izbor automatike. Poslednji snimak mečeva čuva se u privremenom prostoru dodatka i nestaje pri zatvaranju pregledača ili prekidu povezivanja. Snimak ide kroz komponentu već prijavljenog ScoreGuard panela. Dodatak ne preuzima kolačiće, lozinke, druge stranice ili sadržaj ostatka Backoffice-a.

## Ažuriranje na 0.1.1 i provera čitanja

Posle ažuriranja GitHub aplikacije ponovo preuzmi dodatak sa stranice **Chrome uvoz**. Raspakuj ga preko postojeće fascikle dodatka, potvrdi zamenu fajlova, pa na `chrome://extensions` klikni kružnu strelicu **Reload / Ponovo učitaj** za ScoreGuard. U prozoru dodatka treba da piše **v0.1.1**. Ponovo poveži Backoffice i ScoreGuard tabove i klikni **Pročitaj sada**.

Ova verzija razlikuje ugnježdene kopije iste tabele od različitih spiskova, podržava uobičajene grid redove, učitane okvire sa istog porekla i otvorene shadow komponente. Ne spaja dve različite liste niti bira jednu od dve liste sa različitim rezultatima.

Ako čitanje ne uspe, otvori **Detalji čitanja** i kopiraj prikazani tekst. Tu su samo broj dokumenata, tabela, gridova, fudbalskih redova i okvira. Nazivi timova, rezultati, korisnički nalozi i ostatak stranice nisu deo tog pregleda. Taj tekst i konkretna poruka greške omogućavaju prilagođavanje stvarnoj strukturi Backoffice-a bez pristupa nalogu.

## Ažuriranje na 0.1.2

Ponovo preuzmi dodatak iz aplikacije ili novog GitHub ZIP-a, zameni fajlove u postojećoj fascikli i klikni Reload na `chrome://extensions`. U prozoru treba da piše **v0.1.2**. Ponovo poveži otvorene Backoffice i ScoreGuard tabove i klikni **Pročitaj sada**.

Pretraga sada prvo obrađuje grid i ne zaustavlja se posle 20 drugih komponenti. Podržano je čitanje teksta ćelija kroz slotove web komponenti. U **Detaljima čitanja** dokumenti i **Shadow delovi** broje se odvojeno; vidi se i broj ćelija pročitanih kroz slotove. Ako je pretraga ograničena, spisak se ne prenosi delimično. Izbor tačnog selektora grida pretražuje samo taj deo stranice. Dijagnostika i dalje sadrži samo brojeve elemenata.

## Ažuriranje na 0.1.3 — automatski uvoz

U dodatku treba da piše **v0.1.3**. Zamenite fajlove dodatka, kliknite Reload na `chrome://extensions`, zatim osvežite ScoreGuard stranicu, prijavite se i ponovo povežite oba taba. Uključite automatiku u dodatku i prijem u ScoreGuard-u, pa potvrdite spisak i automatski uvoz.

Svako čitanje ima sopstvenu oznaku prenosa, pa se novi snimak šalje i kada se rezultat nije promenio. **Interni unos** pokazuje vreme tog čitanja. Ažurirana aplikacija koristi tu oznaku za zajednički ciklus: ponovljena isporuka istog čitanja ne ponavlja proveru, a novi snimak poništava raniju proveru koja je još u toku. Flashscore/Futbol24 podaci zadržavaju stvarno vreme preuzimanja; zahtevi operatera unutar 15 sekundi mogu deliti isto preuzimanje.

Za samo usklađivanje v0.1.3 već šalje potrebnu oznaku i vreme čitanja. Za ispravljeno čitanje grid kolona koristi v0.1.4 prema koracima ispod.

Dodatak prikazuje **Poslednji pokušaj**, **Poslednje čitanje** i **Sledeće čitanje**. Ako alarm nedostaje nakon ponovnog pokretanja, dodatak ga obnavlja. Otvoren prijemni panel proverava da li je termin dospeo, uz najviše jedno zakazano čitanje po petominutnom periodu. Ručno čitanje je dostupno u svakom trenutku.

**Automatski uvoz** i **provera sportskih izvora** imaju zasebne prekidače. Ako Chrome uvoz prikazuje da su provere izvora pauzirane, kliknite **Uključi provere izvora na 5 minuta**. Samo uključivanje dodatka ne menja prethodno izabranu pauzu provera.

## Ažuriranje na 0.1.4 — redosled i sadržaj grid ćelija

1. Posle ažuriranja aplikacije izaberi **Manage app → Reboot app**.
2. U **Chrome uvoz → Preuzmi Chrome dodatak** preuzmi novi ZIP.
3. Raspakuj fajlove preko postojeće fascikle dodatka i potvrdi zamenu. Na `chrome://extensions` klikni **Reload / Ponovo učitaj**. U dodatku mora da piše **v0.1.4**.
4. Ponovo poveži Backoffice i ScoreGuard tabove, klikni **Pročitaj sada**, pa uključi prijem i potvrdi spisak u ScoreGuard-u.
5. Uključi čitanje na pet minuta, automatski uvoz i provere izabranih izvora.

Vaadin i slični gridovi mogu zadržati ćelije u drugom HTML redosledu iako su kolone na ekranu iste. Čitanje sada koristi njihov prikazani CSS redosled, zatim potpune ARIA indekse ili uobičajeni HTML redosled. Skriveni pomoćni stupci se izostavljaju. Tekst iz slotova čuva cifre šifre, rezultata i vremena, a prazne kolone rezultata ostaju prazne. Jedan neispravan fudbalski red zaustavlja prenos cele tabele.

**Detalji čitanja** pokazuju broj kolona, način sortiranja i brojeve redova sa neispravnom šifrom, vremenom ili nedostajućim nazivima. To su samo brojevi, bez sadržaja spiska. Ako se greška ponovi, taj pregled pokazuje koji deo čitanja zahteva dodatno prilagođavanje. Stvarna Backoffice stranica nije dostupna razvojnom testu; proverene su kontrolisane grid tabele sa istim brojem od 17 fudbalskih redova.

## Ažuriranje na 0.1.5 — poluvreme iz Score 2

Preuzmi novi dodatak kroz **Chrome uvoz**, zameni fajlove postojeće fascikle, klikni **Reload** na `chrome://extensions` i proveri oznaku **v0.1.5**. Posle ažuriranja aplikacije koristi **Manage app → Reboot app**, ponovo poveži oba taba i potvrdi nov spisak sa automatskim uvozom.

Poluvreme se čita iz zaglavlja **Score 2 / Score2**. Podržano je i kada su dva broja zasebni elementi, a dvotačku prikazuje CSS. Trenutni rezultat ostaje iz dve kolone **Home / Away**. Primeri prikaza su **0:6 (0:5)** i **2:1 (2:0)**. Oznaka **Pause** prepoznaje se kao pauza na poluvremenu.

Status dodatka prikazuje koliko je poluvremena pročitano, prazno ili neprepoznato. Prazno ili nejasno polje ne pretvara se u 0:0, a sam zapis bez separatora i bez dva odvojena broja ne nagađa se. Ako je poluvreme već 0:0, nule ostaju sačuvane. U prvom poluvremenu rezultat na poluvremenu još se ne potvrđuje. Minute golova se i dalje samo beleže.
