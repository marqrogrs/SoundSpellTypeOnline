// DO NOT USE THIS SCRIPT
//July 18, 2020
//Some word data was cleaned in data.js, but not in SoundSpellerDatabase.json
//This script goes through data.js and updates SoundSpellerDatabase.json to match
//You should not use this script right off the bat - just use it as a template for similar cases

// const SSJsonFile = "../SoundSpellerDatabase.json"
const fs = require('fs');
// const cleanedData = require("./data");
// const uncleanedData = require(SSJsonFile);

var uncleanedWords = uncleanedData.ssLexicon;
//ssLexicon is an array of objects with the following template:
// {
//   "word_id": "1",
//   "word": "AARDVARK",
//   "phon": "AR D-V AR K",
//   "grap": "A,AR,D,V,AR,K",
//   "syll": "aard.vark"
// },

var cleanedWords = cleanedData.words
//words is an array with the following format:
// [word_id,word,phonemes,graphemes,syllables],
//NOTE: we need to fix this to be an object, but for now we will work with it


uncleanedWords = uncleanedWords.map(uncleanedWordObj => { //For each uncleaned word object...
  var cleanedObj
  cleanedWords.forEach(cleanedWordArr => {   //Iterate over all the cleaned word arrays
    if(cleanedWordArr[0] === parseInt(uncleanedWordObj.word_id)){    //and if the IDs are equal...
      uncleanedWordObj["phon"] = cleanedWordArr[2]        //we will replace the phonemes with the cleaned phonemes
      console.log("Cleaned: ", uncleanedWordObj)
      cleanedObj = uncleanedWordObj
    }
  })
  return cleanedObj
})

uncleanedData.ssLexicon = uncleanedWords

//Now we will rewrite the file with our nice cleaned phonemes
fs.writeFile(SSJsonFile, JSON.stringify(uncleanedData, null, 2),  err => {
  if(err) return console.log(err)
  console.log(`${SSJsonFile} has been overwritten with cleaned values`)
})