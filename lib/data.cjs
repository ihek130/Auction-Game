const COUNTRIES = {
  IN:["India","🇮🇳"], PK:["Pakistan","🇵🇰"], AU:["Australia","🇦🇺"],
  ENG:["England","🏴"], SA:["South Africa","🇿🇦"], NZ:["New Zealand","🇳🇿"],
  SL:["Sri Lanka","🇱🇰"], WI:["West Indies","🌴"], BD:["Bangladesh","🇧🇩"],
  AF:["Afghanistan","🇦🇫"], ZW:["Zimbabwe","🇿🇼"]
};
const CATEGORIES = {
  BAT:{name:"Batters", singular:"Batter", icon:"🏏"},
  WK:{name:"Wicketkeepers", singular:"Wicketkeeper", icon:"🧤"},
  AR:{name:"All-rounders", singular:"All-rounder", icon:"🔥"},
  FAST:{name:"Fast bowlers", singular:"Bowler · Fast", icon:"⚡"},
  SPIN:{name:"Spinners", singular:"Bowler · Spin", icon:"🌀"}
};
const FORMATS = {
  t20:{
    label:"T20", theme:"Power, finishers and bowling variety",
    description:"Explosive batting, adaptable all-rounders and varied attacks. T20 ratings include international and league cricket.",
    targets:{keeper:1, batting:6, bowling:6, pace:2, spin:2, allround:2}
  },
  odi:{
    label:"ODI", theme:"Control, depth and a balanced attack",
    description:"Build innings, cover the middle overs and finish strongly. ODI specialists receive their own career-based game ratings.",
    targets:{keeper:1, batting:6, bowling:5, pace:2, spin:2, allround:1}
  },
  test:{
    label:"Test", theme:"Technique, patience and wicket-taking",
    description:"Durable batting and sustained wicket-taking matter. Test ratings reward red-ball specialists across the eras.",
    targets:{keeper:1, batting:6, bowling:5, pace:3, spin:1, allround:1}
  }
};
const BALANCE = [
  {key:"keeper", name:"Wicketkeeper", weight:30},
  {key:"batting", name:"Batting options", weight:20},
  {key:"bowling", name:"Bowling options", weight:20},
  {key:"pace", name:"Pace options", weight:15},
  {key:"spin", name:"Spin options", weight:15},
  {key:"allround", name:"All-rounders", weight:20}
];

// Curated career-era pool. Era labels identify the generation represented.
// T20 / ODI / Test ratings below are authored game ratings, not official statistics.
// A zero means this cricketer is omitted from that format's curated pool.
const PLAYER_ROWS = [
  "Sachin Tendulkar|IN|BAT|bat|1990s|86|99|99",
  "Brian Lara|WI|BAT|bat|1990s|0|96|99",
  "Ricky Ponting|AU|BAT|bat|2000s|88|97|97",
  "Rahul Dravid|IN|BAT|bat|2000s|79|90|97",
  "Saeed Anwar|PK|BAT|bat|1990s|0|95|90",
  "Inzamam-ul-Haq|PK|BAT|bat|1990s|0|94|94",
  "Javed Miandad|PK|BAT|bat|1990s|0|94|97",
  "Viv Richards|WI|BAT|bat|1990s|0|99|97",
  "Steve Waugh|AU|BAT|bat|1990s|0|90|96",
  "Mark Waugh|AU|BAT|bat|1990s|0|94|90",
  "Matthew Hayden|AU|BAT|bat|2000s|92|95|96",
  "Sourav Ganguly|IN|BAT|bat|2000s|81|94|89",
  "Mahela Jayawardene|SL|BAT|bat|2000s|91|94|96",
  "Chris Gayle|WI|BAT|bat|2010s|99|94|88",
  "Virender Sehwag|IN|BAT|bat|2000s|90|93|95",
  "Kevin Pietersen|ENG|BAT|bat|2000s|94|92|95",
  "Michael Hussey|AU|BAT|bat|2000s|92|93|94",
  "Younis Khan|PK|BAT|bat|2010s|79|89|97",
  "Mohammad Yousuf|PK|BAT|bat|2000s|75|93|96",
  "Alastair Cook|ENG|BAT|bat|2010s|73|83|97",
  "Virat Kohli|IN|BAT|bat|2010s|97|99|96",
  "Rohit Sharma|IN|BAT|bat|2010s|95|97|87",
  "Babar Azam|PK|BAT|bat|2020s|90|96|89",
  "Joe Root|ENG|BAT|bat|2020s|85|94|98",
  "Steve Smith|AU|BAT|bat|2010s|85|91|99",
  "David Warner|AU|BAT|bat|2010s|96|95|93",
  "Kane Williamson|NZ|BAT|bat|2010s|88|94|98",
  "Ross Taylor|NZ|BAT|bat|2010s|87|95|92",
  "Faf du Plessis|SA|BAT|bat|2010s|94|93|88",
  "Suryakumar Yadav|IN|BAT|bat|2020s|98|75|62",
  "Travis Head|AU|BAT|bat|2020s|96|94|93",
  "Shubman Gill|IN|BAT|bat|2020s|89|94|89",
  "Harry Brook|ENG|BAT|bat|2020s|89|88|95",
  "Yashasvi Jaiswal|IN|BAT|bat|2020s|91|77|92",
  "Fakhar Zaman|PK|BAT|bat|2020s|88|93|78",
  "Saim Ayub|PK|BAT|bat|2020s|88|90|79",
  "Shivnarine Chanderpaul|WI|BAT|bat|2000s|77|90|97",
  "Michael Bevan|AU|BAT|bat|1990s|0|97|78",
  "Graham Gooch|ENG|BAT|bat|1990s|0|90|95",
  "Graeme Smith|SA|BAT|bat|2000s|83|91|96",
  "Daryl Mitchell|NZ|BAT|bat|2020s|85|93|88",
  "Tamim Iqbal|BD|BAT|bat|2010s|84|90|88",

  "Adam Gilchrist|AU|WK|wk|2000s|94|98|97",
  "Andy Flower|ZW|WK|wk|1990s|0|94|98",
  "Alec Stewart|ENG|WK|wk|1990s|0|88|92",
  "Moin Khan|PK|WK|wk|1990s|0|86|85",
  "Rashid Latif|PK|WK|wk|1990s|0|84|85",
  "Kumar Sangakkara|SL|WK|wk|2000s|90|97|98",
  "MS Dhoni|IN|WK|wk|2010s|94|98|89",
  "Brendon McCullum|NZ|WK|wk|2010s|96|91|92",
  "Mark Boucher|SA|WK|wk|2000s|81|88|91",
  "AB de Villiers|SA|WK|wk|2010s|99|99|96",
  "Quinton de Kock|SA|WK|wk|2010s|95|95|88",
  "Jos Buttler|ENG|WK|wk|2020s|98|94|80",
  "Mohammad Rizwan|PK|WK|wk|2020s|93|89|89",
  "Sarfaraz Ahmed|PK|WK|wk|2010s|82|87|87",
  "KL Rahul|IN|WK|wk|2020s|90|92|86",
  "Rishabh Pant|IN|WK|wk|2020s|89|84|95",
  "Nicholas Pooran|WI|WK|wk|2020s|97|89|0",
  "Phil Salt|ENG|WK|wk|2020s|95|86|0",
  "Shai Hope|WI|WK|wk|2020s|85|95|78",
  "Jonny Bairstow|ENG|WK|wk|2010s|91|94|90",

  "Imran Khan|PK|AR|pace|1990s|0|97|99",
  "Kapil Dev|IN|AR|pace|1990s|0|93|96",
  "Jacques Kallis|SA|AR|pace|2000s|89|97|99",
  "Shaun Pollock|SA|AR|pace|2000s|88|97|96",
  "Sanath Jayasuriya|SL|AR|spin|1990s|92|97|90",
  "Lance Klusener|SA|AR|pace|1990s|87|96|84",
  "Chris Cairns|NZ|AR|pace|1990s|81|93|92",
  "Andrew Flintoff|ENG|AR|pace|2000s|87|94|94",
  "Shahid Afridi|PK|AR|spin|2000s|95|92|81",
  "Abdul Razzaq|PK|AR|pace|2000s|91|92|85",
  "Shoaib Malik|PK|AR|spin|2010s|91|88|81",
  "Yuvraj Singh|IN|AR|spin|2000s|94|95|78",
  "Shane Watson|AU|AR|pace|2010s|97|95|87",
  "Andrew Symonds|AU|AR|mixed|2000s|93|95|86",
  "Shakib Al Hasan|BD|AR|spin|2010s|94|97|96",
  "Ben Stokes|ENG|AR|pace|2020s|88|95|97",
  "Ravindra Jadeja|IN|AR|spin|2020s|90|91|98",
  "Hardik Pandya|IN|AR|pace|2020s|95|92|80",
  "Andre Russell|WI|AR|pace|2010s|99|86|63",
  "Kieron Pollard|WI|AR|pace|2010s|96|83|0",
  "Dwayne Bravo|WI|AR|pace|2010s|97|89|81",
  "Mohammad Hafeez|PK|AR|spin|2010s|91|89|85",
  "Mohammad Nabi|AF|AR|spin|2020s|94|90|69",
  "Moeen Ali|ENG|AR|spin|2010s|90|86|85",
  "Glenn Maxwell|AU|AR|spin|2020s|97|95|74",
  "Mitchell Marsh|AU|AR|pace|2020s|94|89|83",
  "Shadab Khan|PK|AR|spin|2020s|91|85|70",
  "Wanindu Hasaranga|SL|AR|spin|2020s|96|89|64",
  "Sikandar Raza|ZW|AR|spin|2020s|93|92|80",
  "Jason Holder|WI|AR|pace|2010s|86|91|93",
  "Marcus Stoinis|AU|AR|pace|2020s|91|86|0",
  "Daniel Vettori|NZ|AR|spin|2000s|91|94|94",
  "Mitchell Santner|NZ|AR|spin|2020s|92|90|83",

  "Shane Warne|AU|SPIN|spin|1990s|93|95|99",
  "Muttiah Muralitharan|SL|SPIN|spin|2000s|93|99|99",
  "Anil Kumble|IN|SPIN|spin|1990s|88|93|97",
  "Saqlain Mushtaq|PK|SPIN|spin|1990s|84|97|93",
  "Mushtaq Ahmed|PK|SPIN|spin|1990s|82|91|92",
  "Harbhajan Singh|IN|SPIN|spin|2000s|90|90|93",
  "Ravichandran Ashwin|IN|SPIN|spin|2010s|91|89|98",
  "Nathan Lyon|AU|SPIN|spin|2020s|75|75|96",
  "Rangana Herath|SL|SPIN|spin|2010s|86|83|95",
  "Graeme Swann|ENG|SPIN|spin|2010s|87|89|94",
  "Saeed Ajmal|PK|SPIN|spin|2010s|96|95|93",
  "Rashid Khan|AF|SPIN|spin|2020s|99|97|88",
  "Imran Tahir|SA|SPIN|spin|2010s|97|95|79",
  "Adil Rashid|ENG|SPIN|spin|2020s|95|94|78",
  "Adam Zampa|AU|SPIN|spin|2020s|94|95|0",
  "Kuldeep Yadav|IN|SPIN|spin|2020s|92|95|89",
  "Yuzvendra Chahal|IN|SPIN|spin|2010s|92|89|0",
  "Mujeeb Ur Rahman|AF|SPIN|spin|2020s|92|91|64",
  "Ajantha Mendis|SL|SPIN|spin|2010s|93|92|84",
  "Maheesh Theekshana|SL|SPIN|spin|2020s|92|91|74",
  "Sunil Narine|WI|SPIN|spin|2010s|99|93|77",

  "Wasim Akram|PK|FAST|pace|1990s|0|99|98",
  "Waqar Younis|PK|FAST|pace|1990s|0|98|97",
  "Curtly Ambrose|WI|FAST|pace|1990s|0|96|99",
  "Courtney Walsh|WI|FAST|pace|1990s|0|93|96",
  "Allan Donald|SA|FAST|pace|1990s|0|96|97",
  "Glenn McGrath|AU|FAST|pace|2000s|89|99|99",
  "Chaminda Vaas|SL|FAST|pace|2000s|87|96|93",
  "Heath Streak|ZW|FAST|pace|1990s|0|90|91",
  "Jason Gillespie|AU|FAST|pace|2000s|82|89|92",
  "Shoaib Akhtar|PK|FAST|pace|2000s|88|96|93",
  "Brett Lee|AU|FAST|pace|2000s|94|98|92",
  "Shane Bond|NZ|FAST|pace|2000s|92|97|95",
  "Zaheer Khan|IN|FAST|pace|2000s|87|92|93",
  "James Anderson|ENG|FAST|pace|2010s|78|91|98",
  "Stuart Broad|ENG|FAST|pace|2010s|85|88|96",
  "Dale Steyn|SA|FAST|pace|2010s|96|96|99",
  "Lasith Malinga|SL|FAST|pace|2010s|99|97|87",
  "Mitchell Johnson|AU|FAST|pace|2010s|89|94|95",
  "Mitchell Starc|AU|FAST|pace|2020s|94|99|95",
  "Trent Boult|NZ|FAST|pace|2010s|96|97|94",
  "Tim Southee|NZ|FAST|pace|2010s|92|89|92",
  "Jasprit Bumrah|IN|FAST|pace|2020s|99|97|99",
  "Pat Cummins|AU|FAST|pace|2020s|88|93|99",
  "Josh Hazlewood|AU|FAST|pace|2020s|96|95|96",
  "Kagiso Rabada|SA|FAST|pace|2020s|94|94|97",
  "Shaheen Afridi|PK|FAST|pace|2020s|95|95|91",
  "Mohammad Amir|PK|FAST|pace|2010s|93|93|88",
  "Naseem Shah|PK|FAST|pace|2020s|90|91|88",
  "Jofra Archer|ENG|FAST|pace|2020s|96|94|89",
  "Mark Wood|ENG|FAST|pace|2020s|90|89|91",
  "Mustafizur Rahman|BD|FAST|pace|2010s|95|92|77",
  "Morne Morkel|SA|FAST|pace|2010s|88|92|93"
];
// Ratings and career stat lines are generated from real data — see
// tools/build-ratings.cjs and the sources in data/. PLAYER_ROWS above is kept
// as the curated roster: it fixes each player's id, country, category and
// bowling style, and its order must not change, because a room stores squads
// by player id.
const GENERATED = require('./players.cjs');
const generatedByName = new Map(GENERATED.map(p => [p.name, p]));
const playerPool = PLAYER_ROWS.map((row, id) => {
  const [name, code, category, style, era] = row.split("|");
  const gen = generatedByName.get(name);
  if (!gen) throw new Error(`lib/players.cjs is missing ${name} — run: npm run ratings`);
  return {
    id, name, code, country:COUNTRIES[code][0], flag:COUNTRIES[code][1],
    category, style, era: gen.era || era,
    ratings: gen.ratings,
    stats: gen.stats || {}
  };
});

module.exports = { playerPool, CATEGORIES, FORMATS, BALANCE, COUNTRIES };

