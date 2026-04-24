require("dotenv").config();
const mongoose  = require("mongoose");
const Question  = require("./models/Question");
const QuizConfig = require("./models/QuizConfig");

const aptitude = [
  { text: "A train 150m long passes a pole in 15 seconds. Speed in km/h?", options: ["36","45","54","60"], correctIndex: 0 },
  { text: "If 6 men do work in 10 days, how many days for 15 men?", options: ["4","5","6","8"], correctIndex: 0 },
  { text: "What is 15% of 240?", options: ["36","32","40","48"], correctIndex: 0 },
  { text: "A car covers 60 km in 1.5 hours. Speed in km/h?", options: ["30","40","45","50"], correctIndex: 1 },
  { text: "Simple interest on Rs.2000 at 5% for 3 years?", options: ["Rs.200","Rs.300","Rs.400","Rs.500"], correctIndex: 1 },
  { text: "LCM of 12 and 18 is:", options: ["24","36","48","54"], correctIndex: 1 },
  { text: "If x:y = 3:4, find x when y=20.", options: ["12","15","18","20"], correctIndex: 1 },
  { text: "Average of 5,10,15,20,25?", options: ["12","14","15","16"], correctIndex: 2 },
  { text: "A pipe fills tank in 4 hours, another empties in 12 hours. Together fill in:", options: ["6 hrs","8 hrs","6 hrs","3 hrs"], correctIndex: 0 },
  { text: "HCF of 24, 36, 48 is:", options: ["6","8","12","24"], correctIndex: 2 },
  { text: "Profit on selling Rs.500 item for Rs.600?", options: ["15%","20%","25%","10%"], correctIndex: 1 },
  { text: "Find missing: 2, 6, 12, 20, ___", options: ["28","30","32","36"], correctIndex: 1 },
  { text: "Square root of 324:", options: ["16","17","18","19"], correctIndex: 2 },
  { text: "If 3x+5=20, x=?", options: ["3","4","5","6"], correctIndex: 2 },
  { text: "Item marked Rs.800, 25% discount. Selling price?", options: ["Rs.500","Rs.550","Rs.600","Rs.650"], correctIndex: 2 },
  { text: "Time to travel 180 km at 60 km/h?", options: ["2h","3h","4h","2.5h"], correctIndex: 1 },
  { text: "Compound interest on Rs.1000 at 10% for 2 years?", options: ["Rs.200","Rs.210","Rs.220","Rs.250"], correctIndex: 1 },
  { text: "A number divided by 3 gives remainder 2. Which?", options: ["13","14","15","16"], correctIndex: 1 },
  { text: "Perimeter of rectangle 8x5 cm?", options: ["26 cm","28 cm","30 cm","32 cm"], correctIndex: 0 },
  { text: "52 x 48 = ?", options: ["2396","2496","2596","2696"], correctIndex: 1 },
].map((q,i)=>({...q,section:"aptitude",marks:1,order:i}));

const logical = [
  { text: "If A>B and B>C, then A__C?", options: ["<","=",">","Cannot say"], correctIndex: 2 },
  { text: "Odd one out: Cat, Dog, Parrot, Mango", options: ["Cat","Dog","Parrot","Mango"], correctIndex: 3 },
  { text: "Next: A, C, E, G, ___", options: ["H","I","J","K"], correctIndex: 1 },
  { text: "If COMPUTER=73, MOUSE=?", options: ["54","63","72","81"], correctIndex: 0 },
  { text: "Which shape has no sides?", options: ["Triangle","Square","Circle","Pentagon"], correctIndex: 2 },
  { text: "Book:Author :: Painting:?", options: ["Canvas","Brush","Painter","Gallery"], correctIndex: 2 },
  { text: "3, 9, 27, 81, ___?", options: ["162","243","324","405"], correctIndex: 1 },
  { text: "A is East of B. C is North of B. A is ___ of C?", options: ["NE","SE","SW","NW"], correctIndex: 1 },
  { text: "Odd one out: 3, 5, 7, 9, 11", options: ["3","5","7","9"], correctIndex: 3 },
  { text: "If 1=5, 2=25, 3=125, 4=?", options: ["256","500","625","1000"], correctIndex: 2 },
  { text: "Doctor:Patient :: Lawyer:?", options: ["Court","Judge","Client","Law"], correctIndex: 2 },
  { text: "Next: 2, 4, 8, 16, 32, ___?", options: ["48","56","64","72"], correctIndex: 2 },
  { text: "FLOW->WOLF. TRAP->?", options: ["PART","RATP","TARP","PRAT"], correctIndex: 2 },
  { text: "Odd one out: January, March, May, June", options: ["January","March","May","June"], correctIndex: 3 },
  { text: "A clock shows 3:15. Angle between hands?", options: ["0 deg","7.5 deg","15 deg","22.5 deg"], correctIndex: 1 },
  { text: "All roses are flowers. Some flowers fade. Therefore:", options: ["All roses fade","Some roses fade","No rose fades","Cannot determine"], correctIndex: 3 },
  { text: "Mirror image of d is:", options: ["b","p","q","d"], correctIndex: 0 },
  { text: "Find next: 1, 4, 9, 16, 25, ___", options: ["30","32","36","40"], correctIndex: 2 },
  { text: "Arrange from youngest: grandfather, son, father, grandson", options: ["A,B,C,D","grandson,son,father,grandfather","C,A,B,D","D,C,B,A"], correctIndex: 1 },
  { text: "If P=16, R=18, T=?", options: ["19","20","21","22"], correctIndex: 1 },
].map((q,i)=>({...q,section:"logical",marks:1,order:i}));

const english = [
  { text: "Correct spelling:", options: ["Accomodate","Accommodate","Acommodate","Accommadate"], correctIndex: 1 },
  { text: "Synonym of Benevolent:", options: ["Cruel","Kind","Strict","Angry"], correctIndex: 1 },
  { text: "Antonym of Verbose:", options: ["Wordy","Concise","Fluent","Talkative"], correctIndex: 1 },
  { text: "She ___ to school every day.", options: ["go","going","goes","gone"], correctIndex: 2 },
  { text: "Error: He don't like mangoes.", options: ["He","don't","like","mangoes"], correctIndex: 1 },
  { text: "Passive: She writes a letter:", options: ["A letter is written by her","A letter was written","She had written","A letter has been written"], correctIndex: 0 },
  { text: "Article: ___ honest man.", options: ["A","An","The","No article"], correctIndex: 1 },
  { text: "Plural of Child:", options: ["Childs","Childes","Children","Childrens"], correctIndex: 2 },
  { text: "He is ___ best student in class.", options: ["a","an","the","no article"], correctIndex: 2 },
  { text: "Synonym of Diligent:", options: ["Lazy","Hardworking","Careless","Slow"], correctIndex: 1 },
  { text: "Adjective in: The tall man ran fast.", options: ["The","tall","man","ran"], correctIndex: 1 },
  { text: "Indirect speech: He said I am happy:", options: ["He said he is happy","He said he was happy","He said I was happy","He told he is happy"], correctIndex: 1 },
  { text: "Antonym of Transparent:", options: ["Clear","Open","Opaque","Bright"], correctIndex: 2 },
  { text: "Break the ice means:", options: ["Break something cold","Start a conversation","Stop a fight","Win a game"], correctIndex: 1 },
  { text: "Compound sentence:", options: ["She slept.","She slept and he watched.","Although she slept.","She slept because she was tired."], correctIndex: 1 },
  { text: "She is good ___ painting.", options: ["in","at","on","for"], correctIndex: 1 },
  { text: "Meaning of Ambiguous:", options: ["Clear","Certain","Unclear","Positive"], correctIndex: 2 },
  { text: "Neither he nor she ___ present.", options: ["are","were","was","is"], correctIndex: 3 },
  { text: "One who walks in sleep:", options: ["Insomniac","Somnambulist","Narcissist","Introvert"], correctIndex: 1 },
  { text: "Preposition: She insisted ___ going.", options: ["in","at","on","for"], correctIndex: 2 },
].map((q,i)=>({...q,section:"english",marks:1,order:i}));

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected");
  await Question.deleteMany({});
  await Question.insertMany([...aptitude,...logical,...english]);
  console.log("Inserted",aptitude.length+logical.length+english.length,"questions");
  await QuizConfig.deleteMany({});
  await QuizConfig.create({
    timeLimitMinutes:40, passingScore:30,
    sections:[
      {name:"aptitude",displayName:"Aptitude",questionCount:20},
      {name:"logical",displayName:"Logical Reasoning",questionCount:20},
      {name:"english",displayName:"English",questionCount:20},
    ],
  });
  console.log("Config seeded");
  await mongoose.disconnect();
  process.exit(0);
}
seed().catch(e=>{console.error(e);process.exit(1);});
