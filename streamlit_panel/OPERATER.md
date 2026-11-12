## Čemu služi aplikacija

ScoreGuard upoređuje rezultate iz tvog kopiranog internog spiska sa izabranim izvorima: Flashscore, Futbol24 i API-Football ako je podešen. Prati fudbalske utakmice koje su u toku i završene utakmice. Neslaganje je signal da operater treba da proveri meč.

Svaki operater ima svoj aktivni spisak. Provere i napomene beleže se pod nalogom prijavljenog operatera.

## 1. Prijava i uvoz mečeva

1. Prijavi se svojim korisničkim imenom i lozinkom. U levom meniju proveri ime prijavljenog operatera.
2. Otvori **Uvoz mečeva** i izaberi **Datum prvog dana spiska**. Datum mora odgovarati danu iz kopiranih podataka, npr. „sre“.
3. Kopiraj spisak iz internog programa i nalepi ga u polje **Nalepite kopirane podatke**. Format se prepoznaje automatski.
4. Klikni **Pregledaj unos**. Proveri interne šifre, domaćina i gosta, vreme početka, trenutni rezultat i rezultat poluvremena.
5. Izaberi izvore. Za trenutni test preporučen je **Flashscore**; drugi izvori moraju biti dostupni i podešeni. Po potrebi uključi **Proveravaj automatski na svakih 5 minuta**.
6. Klikni **Uvezi mečeve**, pa otvori **Pregled mečeva**. Dugme **Proveri sada** zahteva novu proveru izabranih izvora.

Novi uvoz zamenjuje tvoj prethodni aktivni spisak. Spisak drugog operatera se ne menja.

Spisak može imati do **1.000 utakmica**. Pregled prikazuje do 100 po strani; provera uvek obuhvata ceo spisak. Promeni **Stranu pregleda** ili upotrebi pretragu.

## 2. Kako se mečevi povezuju i rezultati porede

- Meč se povezuje po domaćinu, gostu, datumu i vremenu početka. Redosled domaćina i gosta mora biti ispravan.
- Najpre se traže identični nazivi ili sačuvana povezivanja. Ako toga nema, meč se automatski povezuje kada je sličnost **svakog kluba najmanje 80%**, uz isti datum, vreme i selekciju. U detaljima vidiš izvorne nazive i procenat za oba kluba.
- Ako postoji blizak drugi kandidat, razlika u prosečnoj sličnosti mora biti najmanje **5 procentnih poena**. U suprotnom meč ostaje za ručnu potvrdu. Naziv takmičenja i rezultat ne odlučuju koji je meč izabran.
- Naziv takmičenja služi za prikaz. Različiti nazivi, npr. „Venecuela Kup“ i „Copa Venezuela“, ne sprečavaju povezivanje.
- Proverava se trenutni rezultat regularnog vremena i rezultat poluvremena kada je primenljiv. Produžeci i penali ne dodaju se rezultatu za 90 minuta.
- U prvom poluvremenu završen rezultat poluvremena još nije dostupan. Minuti golova se ne proveravaju.
- U kopiji iz internog programa **HT označava prvo, a FT drugo poluvreme**. Period utakmice prikazan je i u detaljima meča.
- Oznaka **FT / 2nd half** može ostati i nakon kraja utakmice. Kada izvor potvrdi da je meč završen, ta interna oznaka sama ne izaziva neslaganje. Rezultat i poluvreme i dalje moraju da se poklope; nedostajući ili zastareli podaci ne potvrđuju rezultat.

Ako meč nije pronađen, proveri nazive klubova, datum, vreme i redosled timova. Za slabije poklapanje ili nejasan par koristi predloge ili **Poveži nazive klubova**. Na primer, „Victoria Utd Limbe” i „Victoria United” imaju oko 84% sličnosti i povezuju se automatski kada je ceo par jednoznačan. Procenat opisuje sličnost naziva, a ne pouzdanost sportskog rezultata.

## 3. Provera na 5 minuta i osvežavanje pregleda

**Automatska provera rezultata radi na svakih 5 minuta (300 sekundi)** kada je automatika uključena i aplikacija aktivna. U pregledu vidiš vreme poslednje i sledeće provere.

**Pregled na ekranu osvežava se na svakih 15 sekundi.** Tada prikazuje već preuzete podatke i status provere. Za novu proveru pre sledećeg termina klikni **Proveri sada**.

Operateri dele preuzete podatke izvora. Ručni zahtevi u razmaku do **15 sekundi** mogu koristiti isto preuzimanje. Vreme stvarnog preuzimanja vidiš u detaljima i ono se ne podmlađuje osvežavanjem ekrana.

Ako izvor odbije pristup ili zatraži pauzu, aplikacija prikazuje razlog i poštuje tu pauzu. Ponavljanje klika ne uklanja blokadu izvora.

**Interni spisak je kopirani snimak.** Automatski se preuzimaju novi podaci sa izabranih sajtova, dok interni rezultat ostaje onaj koji si poslednji uvezao. Kada se rezultat u internom programu promeni, ponovo kopiraj i uvezi spisak. Na live meču razlika može poticati od ranijeg internog unosa ili kašnjenja izvora.

## 4. Šta znače statusi

| Status | Značenje i postupak |
|---|---|
| **Usaglašeno — zeleno** | Svi izabrani izvori potvrđuju unesene podatke koji se proveravaju i imaju dovoljno sveže podatke. |
| **Neslaganje — crveno** | Postoji poznata razlika u rezultatu, poluvremenu ili periodu utakmice. Otvori detalje i proveri meč. |
| **Nije provereno — žuto** | Meč nije povezan, podatak nedostaje, izvor nije dostupan ili je podatak zastareo. Ovaj status ne potvrđuje tačnost internog rezultata. |

Podaci izvora stariji od **5 minuta i 30 sekundi** više ne potvrđuju rezultat. Uvek pogledaj vreme poslednje provere. Ako je izabran jedan dostupan i jedan nedostupan izvor, potpuno usaglašavanje nije potvrđeno; poznata razlika se i dalje prikazuje kao neslaganje.

U **Detaljima meča i obradi neslaganja** vidiš razlog oznake: razliku u rezultatu, poluvremenu ili statusu, ili podatak koji nedostaje.

## 5. Kako da obradiš neslaganje

1. U **Pregledu mečeva** izaberi filter **Neslaganja**. Meč možeš pronaći i pretragom kluba, takmičenja ili interne šifre.
2. Otvori **Detalji meča i obrada neslaganja**, izaberi utakmicu i pročitaj razlog oznake.
3. Uporedi interni rezultat, poluvreme i period sa podacima svakog izabranog izvora. Proveri i vreme preuzimanja.
4. Preko **Otvori Flashscore** ili **Otvori Futbol24** pogledaj meč na samom sajtu. Proveri i najnovije stanje u internom programu.
5. U **Napomena operatera** upiši šta si proverio i klikni **Sačuvaj obradu**.
6. Kada dobiješ novu internu vrednost, ponovo uvezi spisak i pokreni proveru.

Sačuvana napomena beleži ko je obradio meč i kada. Ona ne menja rezultat niti uklanja postojeće neslaganje.

## 6. Podešavanja, istorija i kraj smene

U **Podešavanjima** možeš promeniti izvore i uključiti ili pauzirati automatske provere. Klikni **Sačuvaj podešavanja** da primeniš izbor. Ručna provera ostaje dostupna i kada je automatika pauzirana.

U **Istoriji aktivnosti** vidiš prethodne ručne i automatske provere i sačuvane napomene. Istoriju provera možeš preuzeti kao CSV.

Na kraju rada klikni **Odjavi se**. Sama odjava i zatvaranje kartice ne pauziraju uključene provere dok aplikacija radi. Ako želiš da zaustaviš automatski nadzor svog spiska, prvo isključi automatiku u **Podešavanjima** i sačuvaj izbor.

## 7. Povezivanje različitih naziva klubova

1. Otvori **Poveži nazive klubova** iz levog menija ili iz detalja meča.
2. Izaberi klub iz internog spiska ili ručno unesi njegov interni naziv, npr. **Victoria Utd Limbe**.
3. Izaberi izvor i upiši njegov naziv kluba, npr. **Victoria United** na Flashscore-u.
4. Potvrdi da su to isti klub i ista selekcija, pa klikni **Sačuvaj povezivanje**.
5. Vrati se u pregled i klikni **Proveri sada**, ili sačekaj uključenu automatsku proveru.

Lično povezivanje čuva se za tvoj nalog i važi i za naredne uvoze. Administrator može izabrati **Sačuvaj za sve operatere**. Zajedničko povezivanje koriste svi nalozi. Posle dodavanja ili uklanjanja povezivanja potrebna je nova provera. Datum, vreme i redosled domaćina i gosta ostaju obavezni.

U istom ekranu možeš pregledati i ukloniti sačuvane veze. Kroz **Preuzmi povezivanja (JSON)** sačuvaj kopiju, a kroz **Vrati prethodno preuzeta povezivanja** uvezi je na svoj nalog. Ovo je korisno u testnoj verziji ako se lokalni podaci aplikacije izgube. Povezivanja drugog operatera se ne menjaju.

## 8. Predlozi za povezivanje

Poznate skraćenice, poput **Utd / United**, i jednoznačni parovi sa najmanje **80% sličnosti svakog kluba** povezuju se automatski na svakoj proveri. Za automatski povezan meč ne moraš ništa da potvrđuješ. Ova procena ne dodaje trajnu vezu između naziva klubova.

Kod slabijih ili bliskih poklapanja otvori detalje i pogledaj **Predloge povezivanja**. Izaberi meč, proveri oba kluba i selekcije, pa klikni **Potvrdi ovaj par timova**. Aplikacija pamti potvrđenu vezu i pokreće proveru. Sam predlog ne potvrđuje rezultat. Različiti uzrasti, ženske i rezervne ekipe čuvaju se odvojeno. Automatski povezan meč i dalje može imati neslaganje ili nedovoljno sveže podatke.

## 9. Prioritet i zajednička obrada

Na vrhu pregleda su neslaganja završenih mečeva, zatim live razlike, pa mečevi bez dovoljno podataka. Kolona **Interni unos** pokazuje starost kopiranog spiska; tačno vreme je u detaljima. Stari interni rezultat treba ponovo proveriti u internom programu.

Otvori **Zajednička neslaganja**. Slučaj istog meča je zajednički čak i kada ga prati više operatera. Filtriraj slobodne ili svoje slučajeve, izaberi utakmicu i klikni **Preuzmi slučaj**. Kolege vide tvoje ime. **Oslobodi slučaj** vraća ga među slobodne. Za **Zatvori slučaj** upiši šta je provereno. **Ponovo otvori slučaj** vraća ga u rad.

Statusi **Novo**, **U obradi** i **Rešeno** beleže rad operatera. Zatvaranje slučaja ne menja rezultat i ne uklanja crveno neslaganje. Nova drugačija razlika može ponovo otvoriti rešen slučaj. Razlog provere je u detaljima.

## 10. Zvuk i promene rezultata

U levom meniju uključi **Zvučna upozorenja** i klikni **Testiraj zvuk**. Ako pregledač blokira automatsku reprodukciju, pokreni ton u plejeru. Alarm se oglašava za novo ili promenjeno neslaganje, bez ponavljanja za svako osvežavanje iste razlike. Isključi opciju kada želiš da ga utišaš.

U detaljima se nalazi **Promene rezultata ovog meča**: interni rezultat, poluvreme i podaci izvora tokom provera. Istovetna provera ne dodaje novi zapis. Prikazuje se poslednjih 50 promena za izabrani meč. Test čuva do 2.000 promena po operateru tokom najviše 14 dana; rezervna kopija obuhvata sačuvane promene.

## 11. Rezervna kopija

U **Podešavanjima** izaberi **Pripremi rezervnu kopiju**, pa **Preuzmi rezervnu kopiju**. Sačuvaj fajl na svom računaru. Sadrži tvoj spisak, povezivanja, napomene i istoriju promena. Administratorska kopija uključuje i zajednička povezivanja. Ne sadrži lozinke ni pristupne ključeve.

Kroz **Vrati rezervnu kopiju** izaberi prethodno preuzeti fajl i potvrdi zamenu svog spiska. Posle vraćanja automatika je pauzirana, a prethodni rezultati izvora nisu potvrđeni. Klikni **Proveri sada**, pa po potrebi uključi automatiku. Vraćena istorija ima posebnu oznaku.

Ako u Podešavanjima piše da podaci ostaju lokalni, čuvaj rezervne kopije: testna instanca može izgubiti podatke. Ako je administrator povezao spoljnu bazu, aplikacija prikazuje taj status. Uspavljivanje Streamlita u oba slučaja zaustavlja provere dok se aplikacija ponovo ne pokrene.

## 12. Futbol24 kao drugi izvor

U izvorima možeš izabrati **Flashscore**, **Futbol24** ili oba. Futbol24 ne zahteva poseban API ključ. Interval od pet minuta i dugme **Proveri sada** ostaju isti.

Pri prelasku sa prethodnog izvora sačuvani izbor se menja na Futbol24, a prethodna potvrda rezultata se poništava. Pokreni novu proveru. Ranije Sofascore povezivanje naziva nije potvrda naziva na Futbol24: potraži predlog u detaljima ili dodaj povezivanje za Futbol24. Opšta povezivanja za sve izvore nastavljaju da važe. Stara istorija zadržava oznaku izvora iz kog je zaista nastala.

Za običan završen meč porede se rezultat i poluvreme. Za produžetke poredi se izdvojeni rezultat za 90 minuta samo kada je jasno dostupan. Penali se ne dodaju rezultatu. Ako izvor daje samo rezultat penala ili nepoznat period, podatak ostaje neproveren i razlog je u detaljima.
