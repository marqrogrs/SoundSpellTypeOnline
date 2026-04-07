# Emulator checklist: resetStudentPassword access control

Use this checklist to validate callable error handling and authorization behavior locally.

## Prerequisites

1. Install Firebase CLI:
   - npm install -g firebase-tools
2. Log in:
   - firebase login
3. Install project dependencies:
   - npm ci --ignore-scripts
   - npm --prefix functions ci

## Start emulators

Run in the repository root:

```bash
firebase emulators:start --only auth,firestore,database,functions
```

Expected outcome:

- Functions, Firestore, Realtime Database, and Auth emulators start without errors.

## Seed minimum test data

Use the Firebase Emulator UI or scripts to create the following:

1. Educator A user document in Firestore:
   - Collection: users
   - Document ID: educatorA
   - Fields: { email: "educatorA@example.com", progress: {} }

2. Educator B user document in Firestore:
   - Collection: users
   - Document ID: educatorB
   - Fields: { email: "educatorB@example.com", progress: {} }

3. Student record in Realtime Database for Educator A:
   - Path: /students/student1
   - Value: { p: "<existing hash>", educator: "educatorA" }

4. Optional student user doc in Firestore:
   - Collection: users
   - Document ID: student1
   - Fields: { username: "student1", educator: "educatorA", progress: {} }

## Test cases

1. Unauthenticated caller
   - Call resetStudentPassword with no auth context.
   - Expected: unauthenticated.

2. Student caller (non-educator)
   - Sign in as a student/custom token user that does not have a Firestore users doc with email.
   - Call resetStudentPassword for student1.
   - Expected: permission-denied with message "Only educators can reset student passwords.".

3. Educator A resets own student
   - Sign in as educatorA.
   - Call resetStudentPassword with username student1 and a new password.
   - Expected: success status.

4. Educator B resets Educator A student
   - Sign in as educatorB.
   - Call resetStudentPassword for student1.
   - Expected: permission-denied with message "You may only reset passwords for your own students.".

5. Educator resets unknown student
   - Sign in as educatorA.
   - Call resetStudentPassword with username unknownStudent.
   - Expected: not-found with message "Student account was not found.".

## UI verification

1. Run app locally:
   - npm start
2. Attempt password reset flows through the app UI.
3. Confirm the UI surfaces callable failures clearly and does not report false success.

## Regression commands

Run before pushing:

```bash
npm --prefix functions test
npm test -- --watchAll=false --runInBand --silent
npm run build
```
