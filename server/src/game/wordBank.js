// Curated word database. Not AI-generated. Easily extendable with thousands more.
// Each entry: { word, category, difficulty }

const WORDS = [
  // Animals
  { word: "elephant", category: "Animals", difficulty: "easy" },
  { word: "giraffe", category: "Animals", difficulty: "easy" },
  { word: "penguin", category: "Animals", difficulty: "easy" },
  { word: "octopus", category: "Animals", difficulty: "medium" },
  { word: "platypus", category: "Animals", difficulty: "hard" },
  { word: "chameleon", category: "Animals", difficulty: "hard" },

  // Food
  { word: "pizza", category: "Food", difficulty: "easy" },
  { word: "sandwich", category: "Food", difficulty: "easy" },
  { word: "sushi", category: "Food", difficulty: "medium" },
  { word: "spaghetti", category: "Food", difficulty: "medium" },
  { word: "croissant", category: "Food", difficulty: "hard" },

  // Objects
  { word: "umbrella", category: "Objects", difficulty: "easy" },
  { word: "backpack", category: "Objects", difficulty: "easy" },
  { word: "telescope", category: "Objects", difficulty: "medium" },
  { word: "hourglass", category: "Objects", difficulty: "medium" },
  { word: "accordion", category: "Objects", difficulty: "hard" },

  // Vehicles
  { word: "rocket", category: "Vehicles", difficulty: "easy" },
  { word: "bicycle", category: "Vehicles", difficulty: "easy" },
  { word: "submarine", category: "Vehicles", difficulty: "medium" },
  { word: "helicopter", category: "Vehicles", difficulty: "medium" },
  { word: "zeppelin", category: "Vehicles", difficulty: "hard" },

  // Sports
  { word: "soccer", category: "Sports", difficulty: "easy" },
  { word: "bowling", category: "Sports", difficulty: "easy" },
  { word: "surfing", category: "Sports", difficulty: "medium" },
  { word: "fencing", category: "Sports", difficulty: "medium" },
  { word: "badminton", category: "Sports", difficulty: "hard" },

  // Nature
  { word: "volcano", category: "Nature", difficulty: "easy" },
  { word: "rainbow", category: "Nature", difficulty: "easy" },
  { word: "waterfall", category: "Nature", difficulty: "medium" },
  { word: "glacier", category: "Nature", difficulty: "medium" },
  { word: "avalanche", category: "Nature", difficulty: "hard" },

  // Professions
  { word: "firefighter", category: "Professions", difficulty: "easy" },
  { word: "astronaut", category: "Professions", difficulty: "easy" },
  { word: "electrician", category: "Professions", difficulty: "medium" },
  { word: "archaeologist", category: "Professions", difficulty: "hard" },

  // Technology
  { word: "robot", category: "Technology", difficulty: "easy" },
  { word: "keyboard", category: "Technology", difficulty: "easy" },
  { word: "satellite", category: "Technology", difficulty: "medium" },
  { word: "microscope", category: "Technology", difficulty: "medium" },

  // Fantasy
  { word: "dragon", category: "Fantasy", difficulty: "easy" },
  { word: "wizard", category: "Fantasy", difficulty: "easy" },
  { word: "unicorn", category: "Fantasy", difficulty: "easy" },
  { word: "phoenix", category: "Fantasy", difficulty: "medium" },

  // Actions
  { word: "juggling", category: "Actions", difficulty: "medium" },
  { word: "sneezing", category: "Actions", difficulty: "easy" },
  { word: "yawning", category: "Actions", difficulty: "easy" },
  { word: "whispering", category: "Actions", difficulty: "medium" },

  // Funny Words
  { word: "wobble", category: "Funny Words", difficulty: "medium" },
  { word: "squelch", category: "Funny Words", difficulty: "hard" },
  { word: "kerfuffle", category: "Funny Words", difficulty: "hard" },
];

function getWordsByDifficulty(difficulty) {
  if (!difficulty || difficulty === "mixed") return WORDS;
  return WORDS.filter((w) => w.difficulty === difficulty);
}

/** Pick `count` unique random words, optionally filtered by difficulty. */
function pickRandomWords(count, difficulty, excludeSet = new Set()) {
  const pool = getWordsByDifficulty(difficulty).filter(
    (w) => !excludeSet.has(w.word)
  );
  const source = pool.length >= count ? pool : WORDS;
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

module.exports = { WORDS, pickRandomWords };
