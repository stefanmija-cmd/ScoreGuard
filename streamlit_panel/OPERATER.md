## Čemu služi aplikacija

ScoreGuard upoređuje rezultate iz tvog kopiranog internog spiska sa podacima sa Flashscore-a i/ili Sofascore-a. Prati fudbalske utakmice koje su u toku i završene utakmice. Neslaganje je signal da operater treba da proveri meč.

Svaki operater ima svoj aktivni spisak. Provere i napomene beleže se pod nalogom prijavljenog operatera.

## 1. Prijava i uvoz mečeva

1. Prijavi se svojim korisničkim imenom i lozinkom. U levom meniju proveri ime prijavljenog operatera.
2. Otvori **Uvoz mečeva** i izaberi **Datum prvog dana spiska**. Datum mora odgovarati danu iz kopiranih podataka, npr. „sre“.
3. Kopiraj spisak iz internog programa i nalepi ga u polje **Nalepite kopirane podatke**. Format se prepoznaje automatski.
4. Klikni **Pregledaj unos**. Proveri interne šifre, domaćina i gosta, vreme početka, trenutni rezultat i rezultat poluvremena.
5. Izaberi **Flashscore**, **Sofascore** ili oba izvora. Po potrebi uključi **Proveravaj automatski na svakih 5 minuta**.
6. Klikni **Uvezi mečeve**, pa otvori **Pregled mečeva**. Dugme **Proveri sada** zahteva novu proveru izabranih izvora.

Novi uvoz zamenjuje tvoj prethodni aktivni spisak. Spisak drugog operatera se ne menja.

## 2. Kako se mečevi povezuju i rezultati porede

- Meč se povezuje po domaćinu, gostu, datumu i vremenu početka. Redosled domaćina i gosta mora biti ispravan.
- Naziv takmičenja služi za prikaz. Različiti nazivi, npr. „Venecuela Kup“ i „Copa Venezuela“, ne sprečavaju povezivanje.
- Proverava se trenutni rezultat regularnog vremena i rezultat poluvremena kada je primenljiv. Produžeci i penali ne dodaju se rezultatu za 90 minuta.
- U prvom poluvremenu završen rezultat poluvremena još nije dostupan. Minuti golova se ne proveravaju.
- U kopiji iz internog programa **HT označava prvo, a FT drugo poluvreme**. Period utakmice prikazan je i u detaljima meča.

Ako meč nije pronađen, proveri nazive klubova, datum, vreme i redosled timova. Različiti nazivi samih klubova mogu zahtevati usklađivanje naziva. Kada postoji više mogućih mečeva, aplikacija ne bira proizvoljno.

## 3. Provera na 5 minuta i osvežavanje pregleda

**Automatska provera rezultata radi na svakih 5 minuta (300 sekundi)** kada je automatika uključena i aplikacija aktivna. U pregledu vidiš vreme poslednje i sledeće provere.

**Pregled na ekranu osvežava se na svakih 15 sekundi.** Tada prikazuje već preuzete podatke i status provere. Za novu proveru pre sledećeg termina klikni **Proveri sada**.

Ako izvor odbije pristup ili zatraži pauzu, aplikacija prikazuje razlog i poštuje tu pauzu. Ponavljanje klika ne uklanja blokadu izvora.

**Interni spisak je kopirani snimak.** Automatski se preuzimaju novi podaci sa izabranih sajtova, dok interni rezultat ostaje onaj koji si poslednji uvezao. Kada se rezultat u internom programu promeni, ponovo kopiraj i uvezi spisak. Na live meču razlika može poticati od ranijeg internog unosa ili kašnjenja izvora.

## 4. Šta znače statusi

| Status | Značenje i postupak |
|---|---|
| **Usaglašeno — zeleno** | Svi izabrani izvori potvrđuju unesene podatke koji se proveravaju i imaju dovoljno sveže podatke. |
| **Neslaganje — crveno** | Postoji poznata razlika u rezultatu, poluvremenu ili periodu utakmice. Otvori detalje i proveri meč. |
| **Nije provereno — žuto** | Meč nije povezan, podatak nedostaje, izvor nije dostupan ili je podatak zastareo. Ovaj status ne potvrđuje tačnost internog rezultata. |

Podaci izvora stariji od **5 minuta i 30 sekundi** više ne potvrđuju rezultat. Uvek pogledaj vreme poslednje provere. Ako je izabran jedan dostupan i jedan nedostupan izvor, potpuno usaglašavanje nije potvrđeno; poznata razlika se i dalje prikazuje kao neslaganje.

## 5. Kako da obradiš neslaganje

1. U **Pregledu mečeva** izaberi filter **Neslaganja**. Meč možeš pronaći i pretragom kluba, takmičenja ili interne šifre.
2. Otvori **Detalji meča i obrada neslaganja** i izaberi utakmicu.
3. Uporedi interni rezultat, poluvreme i period sa podacima svakog izabranog izvora. Proveri i vreme preuzimanja.
4. Preko **Otvori Flashscore** ili **Otvori Sofascore** pogledaj meč na samom sajtu. Proveri i najnovije stanje u internom programu.
5. U **Napomena operatera** upiši šta si proverio i klikni **Sačuvaj obradu**.
6. Kada dobiješ novu internu vrednost, ponovo uvezi spisak i pokreni proveru.

Sačuvana napomena beleži ko je obradio meč i kada. Ona ne menja rezultat niti uklanja postojeće neslaganje.

## 6. Podešavanja, istorija i kraj smene

U **Podešavanjima** možeš promeniti izvore i uključiti ili pauzirati automatske provere. Klikni **Sačuvaj podešavanja** da primeniš izbor. Ručna provera ostaje dostupna i kada je automatika pauzirana.

U **Istoriji aktivnosti** vidiš prethodne ručne i automatske provere i sačuvane napomene. Istoriju provera možeš preuzeti kao CSV.

Na kraju rada klikni **Odjavi se**. Sama odjava i zatvaranje kartice ne pauziraju uključene provere dok aplikacija radi. Ako želiš da zaustaviš automatski nadzor svog spiska, prvo isključi automatiku u **Podešavanjima** i sačuvaj izbor.
