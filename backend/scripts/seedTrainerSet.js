/*
 * Seed the "DS/DA Trainer Technical Screening" question bank as round-2 set "T".
 *
 * Source: DS_DA_Trainer_Technical_Screening_Questionnaire.pdf
 *   Section A  tr_sec_a  12 MCQ   Data Analytics (SQL, Statistics, BI)
 *   Section B  tr_sec_b  12 MCQ   Data Science / Machine Learning
 *   Section C  tr_sec_c  10 text  Application-level (open-ended, manual review)
 *   Section D  tr_sec_d  10 text  Output prediction (Python / Pandas / SQL)
 *   Section E  tr_sec_e  10 text  Scenario-based (open-ended, manual review)
 *
 * Unlike sets A–D this bank is ONE set, so every candidate gets the same paper
 * (round2Sets: ["T"] — the round-robin has a single entry).
 *
 * Open-ended questions carry the PDF's "What to look for" guidance in
 * `answerText`. That is admin-only (never sent to the candidate) and shows up
 * beside the typed answer on the response-review screen, so an evaluator can
 * mark them by hand. Exact-match auto-scoring will count them wrong.
 *
 *   node scripts/seedTrainerSet.js                    # unscoped (matches seedTechRound2All)
 *   node scripts/seedTrainerSet.js --workspace=<id>   # attach to one workspace
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Question = require("../models/Question");

const SET = "T";

const mcq = (text, options, correctIndex) => ({ type: "mcq", text, options, correctIndex });
// Open-ended: `answer` is the model answer / rubric shown to the evaluator only.
const long = (text, answer) => ({ type: "text", text, answerText: answer, longAnswer: true });
// Short typed answer with a crisp exact output — auto-scored by exact match.
const short = (text, answer) => ({ type: "text", text, answerText: answer, longAnswer: false });

/* ── Section A — MCQs: Data Analytics (SQL, Statistics, BI) ────────────────── */
const SECTION_A = [
  mcq("In SQL, which function would correctly rank employees by salary within each department, giving the same rank to ties without skipping numbers?",
    ["ROW_NUMBER()", "RANK()", "DENSE_RANK()", "NTILE()"], 2),
  mcq("A dataset's mean is significantly higher than its median. What does this most likely indicate?",
    ["The data is normally distributed", "The data is right-skewed (positively skewed)", "The data is left-skewed (negatively skewed)", "The data has no outliers"], 1),
  mcq("Which SQL clause is used to filter groups AFTER aggregation (e.g., departments with average salary > 50000)?",
    ["WHERE", "GROUP BY", "HAVING", "ORDER BY"], 2),
  mcq("A KPI dashboard shows a 20% MoM increase in revenue but a 5% decrease in profit margin. Which metric combination should a good analyst check first?",
    ["Website traffic only", "Cost of goods sold and discounting trends", "Number of dashboard views", "Employee headcount"], 1),
  mcq("In a box plot, a data point beyond 1.5 times the IQR from Q1 or Q3 is typically classified as:",
    ["The median", "A whisker", "An outlier", "The interquartile range"], 2),
  mcq("Which type of JOIN returns all rows from the left table and only matching rows from the right table?",
    ["INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL OUTER JOIN"], 1),
  mcq("A survey has a margin of error of ±3% at a 95% confidence level. What does this actually mean?",
    ["There is a 95% chance the true value falls within ±3% of the sample estimate, if the sampling process is repeated",
     "95% of respondents answered correctly",
     "The survey has a 3% error rate in data entry",
     "3% of the sample was discarded as invalid"], 0),
  mcq("Which measure of central tendency is LEAST affected by outliers?",
    ["Mean", "Median", "Standard deviation", "Range"], 1),
  mcq("In Power BI / Tableau, which technique would you use to show running/cumulative revenue over time?",
    ["A calculated field with SUM only", "A running total / cumulative measure using window functions", "A simple bar chart", "A pie chart"], 1),
  mcq("Two variables have a correlation coefficient of 0.92. What can you conclude?",
    ["One variable definitely causes the other", "There is a strong linear relationship between them", "There is no relationship between them", "The relationship is necessarily non-linear"], 1),
  mcq("A/B test result: Variant B has a higher conversion rate, but the sample size is only 40 users per group. What should the analyst do?",
    ["Immediately roll out Variant B", "Ignore the test entirely", "Check statistical significance and consider the test underpowered; collect more data", "Average the two conversion rates"], 2),
  mcq("Which SQL window function would you use to compare each month's sales with the previous month's sales in the same query?",
    ["SUM() OVER()", "LAG()", "COUNT()", "GROUP BY"], 1),
];

/* ── Section B — MCQs: Data Science / Machine Learning ─────────────────────── */
const SECTION_B = [
  mcq("A model has 99% training accuracy but 65% test accuracy. This is a classic sign of:",
    ["Underfitting", "Overfitting", "High bias", "Data leakage prevention"], 1),
  mcq("For a binary classification problem with a highly imbalanced dataset (95% class A, 5% class B), which metric is MOST misleading if used alone?",
    ["Precision", "Recall", "Accuracy", "F1-score"], 2),
  mcq("Which regularization technique tends to shrink some coefficients exactly to zero, effectively performing feature selection?",
    ["Ridge (L2)", "Lasso (L1)", "Elastic Net only", "Dropout"], 1),
  mcq("In k-fold cross-validation, what is the primary purpose of using multiple folds instead of a single train-test split?",
    ["To speed up training", "To get a more reliable estimate of model performance and reduce variance from a single split", "To increase the size of the training dataset", "To eliminate the need for a test set entirely"], 1),
  mcq("Which algorithm is most sensitive to feature scaling (i.e., requires normalization/standardization to perform well)?",
    ["Decision Tree", "Random Forest", "K-Nearest Neighbors (KNN)", "Naive Bayes"], 2),
  mcq("A model's ROC-AUC score is 0.5. What does this indicate?",
    ["The model is performing extremely well", "The model is performing no better than random guessing", "The model has perfect precision", "The model is overfitting badly"], 1),
  mcq("In a decision tree, what does a lower Gini impurity at a node indicate?",
    ["The node has high class diversity", "The node is closer to being pure (dominated by one class)", "The tree is overfitting", "The split feature is irrelevant"], 1),
  mcq("Which of these is NOT a valid method to address multicollinearity in a linear regression model?",
    ["Removing one of the correlated variables", "Using Principal Component Analysis (PCA)", "Applying Ridge regression", "Increasing the learning rate"], 3),
  mcq("What is the main risk of using the test set multiple times to tune hyperparameters?",
    ["It has no risk, more tuning is always better", "The model may indirectly overfit to the test set, giving an overly optimistic performance estimate", "It reduces model training time", "It guarantees better generalization"], 1),
  mcq("Which activation function is most associated with the 'vanishing gradient' problem in deep neural networks?",
    ["ReLU", "Sigmoid / Tanh", "Leaky ReLU", "Softmax (output layer)"], 1),
  mcq("A dataset has 40% missing values in one column, and the missingness pattern correlates strongly with the target variable. What is the safest immediate action?",
    ["Drop the column without investigation", "Fill with the mean and move on", "Investigate WHY it's missing (Missing Not At Random) before deciding to impute, flag, or drop", "Delete all rows with any missing value"], 2),
  mcq("Which evaluation metric would you prioritize for a cancer-screening model where missing a positive case is far costlier than a false alarm?",
    ["Precision", "Recall (Sensitivity)", "Specificity", "Accuracy"], 1),
];

/* ── Section C — Application-Level Questions (open-ended) ──────────────────── */
const SECTION_C = [
  long("You're given a table orders(order_id, customer_id, order_date, amount). Write a query to find customers who placed orders in every one of the last 3 months. Explain your approach before writing SQL.",
    "What to look for: grouping by customer + month, counting distinct months, comparing count = 3, awareness of edge cases like customers with no orders in a month."),
  long("Your model has 95% training accuracy and 60% validation accuracy. Walk through the 3-4 specific steps you'd take next, in order.",
    "What to look for: a diagnostic sequence — check for overfitting → add regularization / reduce complexity → get more training data → re-check validation strategy (data leakage, proper split). Not just naming 'overfitting'."),
  long("A company's revenue dropped 15% last month. As the analyst, describe your actual investigation process step by step.",
    "What to look for: data quality check first, segmenting by product/region/channel, checking for seasonality or one-off events, comparing YoY not just MoM, forming and testing a hypothesis rather than guessing."),
  long("You have 200 features and only 500 rows of data. Which algorithms would you avoid and what would you do instead?",
    "What to look for: curse of dimensionality awareness, avoiding complex/high-variance models, using regularized models (Lasso/Ridge), dimensionality reduction (PCA), or feature selection."),
  long("A stakeholder asks you to explain 'why' your model rejected a specific loan application. How does this requirement change your model choice and workflow?",
    "What to look for: interpretability vs. accuracy tradeoff, mention of SHAP/LIME or inherently interpretable models like logistic regression / decision trees, and understanding of regulatory context (e.g., lending explainability requirements)."),
  long("Explain how you would detect and handle multicollinearity in a regression model you're building for a client.",
    "What to look for: VIF (Variance Inflation Factor), correlation matrix inspection, and remedies (dropping variables, PCA, regularization) — not just a definition."),
  long("Two datasets need to be merged on customer ID, but the IDs don't always match exactly due to formatting/typos. Describe your approach.",
    "What to look for: fuzzy matching techniques, standardizing formats before matching, validation checks post-merge, and awareness of false-positive matches."),
  long("You're asked to build an executive dashboard. What three questions would you ask the stakeholder before building anything, and why?",
    "What to look for: understanding audience/decision needs, refresh frequency, and what action the dashboard should drive — not jumping straight into chart types."),
  long("Explain bias-variance tradeoff using a real example from a project you've worked on (not the textbook definition).",
    "What to look for: ability to translate an abstract concept into a concrete, relatable example — a core trainer skill."),
  long("A p-value of 0.04 suggests a marketing campaign 'worked.' The business wants to say this confidently. How do you respond?",
    "What to look for: distinguishing statistical significance from practical/business significance, checking effect size, correlation vs. causation, and confounding variables."),
];

/* ── Section D — Output Prediction (Python / Pandas / SQL) ─────────────────── */
const SECTION_D = [
  short("What is the output of the following Python code?\nx = [1, 2, 3]\ny = x\ny.append(4)\nprint(x)",
    "[1, 2, 3, 4]"),
  short("What will this pandas code print?\nimport pandas as pd\ndf = pd.DataFrame({'a':[1,2,None,4]})\nprint(df['a'].mean())",
    "2.3333333333333335"),
  short("Predict the output:\nimport numpy as np\narr = np.array([1, 2, 3])\nprint(arr + 2)",
    "[3 4 5]"),
  long("What does this SQL query return, assuming the sales table has NULLs in the region column?\nSELECT region, COUNT(*)\nFROM sales\nGROUP BY region;",
    "One row for each distinct region value INCLUDING a row where region is NULL, with its own count — NULLs are grouped together as one group."),
  long("What is printed by this code?\ndef f(a, b=[]):\n    b.append(a)\n    return b\n\nprint(f(1))\nprint(f(2))",
    "[1] then [1, 2] — classic Python mutable default argument pitfall; the same list persists across calls."),
  long("Predict the result of this pandas groupby operation:\ndf = pd.DataFrame({'grp':['A','A','B'], 'val':[10,20,30]})\nprint(df.groupby('grp')['val'].sum())",
    "A → 30, B → 30 (grouped sum: A = 10 + 20 = 30, B = 30)."),
  long("What will this train_test_split call produce if run twice without setting a seed?\nfrom sklearn.model_selection import train_test_split\nX_train, X_test = train_test_split(data, test_size=0.2)",
    "A different split each time — without a fixed random_state/seed, the train/test rows will vary between runs."),
  short("What is the output?\nprint(0.1 + 0.2 == 0.3)",
    "False"),
  long("What does this SQL return if the orders table has 5 rows where discount is NULL?\nSELECT AVG(discount) FROM orders;",
    "A single value that is the average of only the non-NULL discount values — if ALL 5 rows are NULL, AVG() returns NULL, not 0."),
  short("Predict the shape printed by this code:\nimport numpy as np\na = np.array([[1,2,3],[4,5,6]])\nprint(a.reshape(3,2).shape)",
    "(3, 2)"),
];

/* ── Section E — Scenario-Based Questions (open-ended) ─────────────────────── */
const SECTION_E = [
  long("A batch of 25 students has a wide skill gap — some know Python basics, others have never coded. As a trainer, how would you structure the first two weeks?",
    "What to look for: pedagogy sense — pre-assessment, tiered exercises, buddy/mentor pairing, optional bridge sessions. Not just 'I'd teach the basics first'."),
  long("During a live session, a student asks a question you don't know the answer to. What do you do in that moment, and afterward?",
    "What to look for: honesty over bluffing, a plan to follow up with a verified answer, and turning it into a learning moment for the class."),
  long("Your client wants a churn prediction model in production within 2 weeks, but the data has serious quality issues. How do you handle the client conversation and the technical plan?",
    "What to look for: expectation management, transparent communication about risk/timeline tradeoffs, and a phased delivery plan (baseline model first, improve iteratively)."),
  long("A hiring manager asks you to justify why you chose Random Forest over Logistic Regression for a specific business problem. How do you respond?",
    "What to look for: comparing interpretability, non-linearity handling, performance, and business context — not just 'Random Forest is more accurate'."),
  long("Midway through a course, feedback shows students find your pace too fast. What concrete changes would you make?",
    "What to look for: willingness to adapt, concrete mechanisms (recorded recaps, extra doubt sessions, revised pacing) rather than vague reassurance."),
  long("A company's dashboard shows increasing sales, but the sales team says 'it doesn't feel right.' How do you investigate this discrepancy?",
    "What to look for: checking data pipeline/ETL issues, definition mismatches (e.g., gross vs net sales), and validating with source data before trusting the dashboard."),
  long("You're asked to teach both Data Analytics and Data Science tracks to the same cohort. How would you sequence the curriculum so concepts build on each other logically?",
    "What to look for: a coherent learning path (e.g., statistics / SQL / Excel foundations → Python → ML), not two disconnected tracks."),
  long("A student submits a project with a suspiciously perfect 99% accuracy on customer churn prediction. How do you address this with the student?",
    "What to look for: suspicion of data leakage or target leakage, guiding the student to investigate rather than just praising or dismissing the result."),
  long("Leadership wants to cut the course duration by 30% but keep 'the same outcomes.' As the trainer, how do you respond and what would you propose?",
    "What to look for: pushing back constructively with data/reasoning, proposing trade-offs (e.g., prioritizing high-impact topics, flipped-classroom pre-reading) rather than simply agreeing."),
  long("A student from a non-technical background says they feel 'lost' in every session despite trying hard. What's your approach over the next week?",
    "What to look for: empathy combined with a concrete plan — diagnostic 1:1, foundational gap-filling resources, checkpoints — showing real teaching responsibility, not just sympathy."),
];

const BANK = [
  ["tr_sec_a", SECTION_A],
  ["tr_sec_b", SECTION_B],
  ["tr_sec_c", SECTION_C],
  ["tr_sec_d", SECTION_D],
  ["tr_sec_e", SECTION_E],
];

const SECTIONS = BANK.map(([name]) => name);

// Question documents for the whole bank. Exported so it can be validated
// without a database connection.
function buildDocs(wsId = null) {
  const docs = [];
  BANK.forEach(([section, list]) => {
    list.forEach((q, i) => docs.push({
      ...(wsId ? { workspaceId: new mongoose.Types.ObjectId(wsId) } : {}),
      text: q.text,
      type: q.type,
      options: q.type === "mcq" ? q.options : undefined,
      correctIndex: q.type === "mcq" ? q.correctIndex : null,
      answerText: q.type === "text" ? q.answerText : null,
      longAnswer: !!q.longAnswer,
      reference: null,
      marks: 1,
      section,
      order: i,
      round: 2,
      set: SET,
    }));
  });
  return docs;
}

module.exports = { SET, SECTIONS, buildDocs };

async function main() {
  if (!process.env.MONGO_URI) { console.error("MONGO_URI not set"); process.exit(1); }

  const wsArg = process.argv.find(a => a.startsWith("--workspace="));
  const wsId = wsArg ? wsArg.split("=")[1] : null;
  if (wsId && !mongoose.isValidObjectId(wsId)) { console.error(`Invalid workspace id: ${wsId}`); process.exit(1); }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  const docs = buildDocs(wsId);

  // Re-runnable: only ever touches this set's own sections, so sets A–D and the
  // round-1 pool are untouched.
  const scope = { round: 2, set: SET, section: { $in: SECTIONS },
    ...(wsId ? { workspaceId: new mongoose.Types.ObjectId(wsId) } : { workspaceId: { $exists: false } }) };
  const del = await Question.deleteMany(scope);
  const inserted = await Question.insertMany(docs, { ordered: false });
  console.log(`Removed ${del.deletedCount} old set-${SET} questions; inserted ${inserted.length}${wsId ? ` into workspace ${wsId}` : " (unscoped)"}.`);

  const agg = await Question.aggregate([
    // Scoped like the write above. Matching on round+set alone counted EVERY
    // workspace's copy, so seeding a second workspace reported doubled totals.
    { $match: scope },
    { $group: { _id: { section: "$section", type: "$type" }, n: { $sum: 1 } } },
    { $sort: { "_id.section": 1 } },
  ]);
  agg.forEach(a => console.log(`  set ${SET} · ${a._id.section} · ${a._id.type}: ${a.n} Qs`));

  await mongoose.disconnect();
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
