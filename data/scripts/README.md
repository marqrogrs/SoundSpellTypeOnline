## Scripts

This directory contains scripts for populating the MongoDB Atlas.

### data.js

Exports words, phonemes and lessons as arrays.

### uploadDB.js

Uploads all words, phonemes and lessons to MongoDB Atlas.

To run:

```
export DB_NAME="<Insert DB Name>"
export DB_PASSWORD="<Insert MongoDB Password>" // ask Mark or another dev
cd data/scripts
npm install
node uploadDB.js
```
