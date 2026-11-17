// Storyboards for the public explainer videos. Each scene opens a route on the seeded local QA server, optionally clicks something, then
// holds so the caption can be read. Captions are [English, Hinglish]. Edit here and re-run `node scripts/record-guide.mjs`.
// scene: { path, caption: [en, hi], hold?: ms (default derived from caption length), click?: "visible text", scroll?: px }
export const storyboards = {
  owner: {
    session: "owner",
    out: "owner",
    scenes: [
      { path: "/owner", caption: ["Your whole library on one screen: who is in, what is due and what needs attention.", "Poori library ek screen par: kaun andar hai, kiski fees baaki hai, kya dhyaan maangta hai."] },
      { path: "/owner/seats", caption: ["The seat map shows every seat, shift by shift, and which are free.", "Seat map har seat dikhata hai, shift ke hisaab se, aur kaun si khaali hai."] },
      { path: "/owner/plans", caption: ["Set your fee plans once, for example Monthly for 30 days.", "Fee plans ek baar set karein, jaise Monthly 30 din ke liye."] },
      { path: "/owner/join-requests", caption: ["Students join with your Library ID. You choose a seat, shift and plan, then approve.", "Students aapki Library ID se judte hain. Aap seat, shift, plan chunkar approve karte hain."] },
      { path: "/owner/students", caption: ["Every student, their membership and what they owe, in one list.", "Har student, unki membership aur baaki fees, ek list mein."] },
      { path: "/owner/payments", caption: ["Record cash or UPI fees. The receipt shows up in the student's app.", "Cash ya UPI fees darj karein. Receipt student ke app mein dikhti hai."] },
      { path: "/owner/attendance", caption: ["See who is in the library today. Students punch in only from inside.", "Aaj kaun library mein hai dekhein. Students sirf andar se punch in kar sakte hain."] },
      { path: "/owner/reports", caption: ["Monthly reports show income, expenses and profit.", "Monthly reports mein income, kharcha aur munafa dikhta hai."] },
      { path: "/owner/security", caption: ["Owners sign in with a password plus an authenticator code. Keep your recovery codes safe.", "Owners password ke saath authenticator code se sign in karte hain. Recovery codes sambhal kar rakhein."] },
    ],
  },
  student: {
    session: "student",
    out: "student",
    scenes: [
      { path: "/app", caption: ["Your home screen: today's focus, streak and what to do next.", "Aapki home screen: aaj ka focus, streak aur aage kya karna hai."] },
      { path: "/app/join", caption: ["Join your library by typing the Library ID from the desk.", "Counter se mili Library ID daalkar apni library join karein."] },
      { path: "/app/membership", caption: ["See your seat, shift, plan and when your membership ends.", "Apni seat, shift, plan aur membership kab khatam hogi, dekhein."] },
      { path: "/app/punch", caption: ["Punch in with one tap, from inside the library only.", "Ek tap mein punch in, sirf library ke andar se."] },
      { path: "/app/focus", caption: ["Start a focus session. Time is counted on the server, and you earn XP.", "Focus session shuru karein. Samay server par gina jaata hai, aur XP milta hai."] },
      { path: "/app/quests", caption: ["Daily quests give you small goals that keep your streak going.", "Daily quests chhote goals dete hain jo streak chalti rakhte hain."] },
      { path: "/app/prep", caption: ["Prepare for your exam with a syllabus, mock tests and revision.", "Syllabus, mock tests aur revision ke saath exam ki taiyaari karein."] },
      { path: "/app/security", caption: ["Manage your sign-in and security settings here.", "Apni sign-in aur security settings yahan sambhalein."] },
    ],
  },
  "owner-overview": { session: "owner", group: "pages", dir: "owner", name: "01-overview", scenes: [
      { path: "/owner", caption: ["This is your dashboard: today's money, students and seats at a glance.", "Yeh aapka dashboard hai: aaj ka paisa, students aur seats ek nazar mein."] },
      { path: "/owner", caption: ["Scroll down for what needs attention: dues, expiring memberships and requests.", "Neeche dekhein: baaki fees, khatam hoti memberships aur requests."], scroll: 500 },
      { path: "/owner", caption: ["The menu on the left takes you to every part of your library.", "Left menu se library ke har hisse mein jaa sakte hain."], scroll: 500 },
  ] },
  "owner-branches": { session: "owner", group: "pages", dir: "owner", name: "25-branches", scenes: [
      { path: "/owner/branches", caption: ["If you run more than one library, see every branch in one view.", "Agar ek se zyada library hain, toh sab branches ek jagah dekhein."] },
      { path: "/owner/branches", caption: ["Each branch keeps its own seats, shifts, fees, staff and accounts.", "Har branch ki apni seats, shifts, fees, staff aur hisaab hota hai."], scroll: 400 },
      { path: "/owner/branches", caption: ["Add a branch, then give staff the branches they should handle.", "Nayi branch jodein, phir staff ko unki branch saunpein."], scroll: 400 },
  ] },
  "owner-billing": { session: "owner", group: "pages", dir: "owner", name: "26-billing", scenes: [
      { path: "/owner/billing", caption: ["This is your StudyQuest plan. It is separate from your students' fees.", "Yeh aapka StudyQuest plan hai. Yeh students ki fees se alag hai."] },
      { path: "/owner/billing", caption: ["See your limits and usage. The free plan needs no card.", "Apni limits aur usage dekhein. Free plan mein card nahi chahiye."], scroll: 450 },
      { path: "/owner/billing", caption: ["A paid plan starts only after the payment gateway confirms the payment.", "Paid plan tabhi shuru hota hai jab payment gateway payment confirm kare."], scroll: 450 },
  ] },
  "owner-settings": { session: "owner", group: "pages", dir: "owner", name: "28-settings", scenes: [
      { path: "/owner/settings", caption: ["Your library workspace details live here, and stay private to your library.", "Library workspace ki jaankari yahan hai, aur sirf aapki library tak seemit rehti hai."] },
      { path: "/owner/settings", caption: ["Under Manage, Team & roles gives staff limited access, for example only attendance or only payments.", "Manage mein Team & roles se staff ko seemit access dein, jaise sirf attendance ya sirf payments."] },
      { path: "/owner/settings", caption: ["The Activity tab shows who changed what, and when.", "Activity tab mein dikhta hai kisne, kab, kya badla."], click: "Activity" },
  ] },
  "owner-security": { session: "owner", group: "pages", dir: "owner", name: "29-security", scenes: [
      { path: "/owner/security", caption: ["Account and privacy: change your password here.", "Account aur privacy: yahan apna password badlein."] },
      { path: "/owner/security", caption: ["Two-step sign-in is required for owners: a code from your authenticator app, plus recovery codes.", "Owners ke liye two-step sign-in zaroori hai: authenticator app ka code, aur recovery codes."], scroll: 350 },
      { path: "/owner/security", caption: ["Sign out of all devices, download your data and review the terms you accepted.", "Sabhi devices se logout, apna data download aur accept kiye terms dekhein."], scroll: 450 },
  ] },
  "student-overview": { session: "student", group: "pages", dir: "student", name: "01-overview", scenes: [
      { path: "/app", caption: ["Your home screen: your library, membership and what to do next.", "Aapki home screen: aapki library, membership aur aage kya karna hai."] },
      { path: "/app", caption: ["Scroll for your quests, announcements and progress.", "Quests, announcements aur progress ke liye neeche dekhein."], scroll: 450 },
  ] },
  "student-join": { session: "student", group: "pages", dir: "student", name: "02-join", scenes: [
      { path: "/app/join", caption: ["Ask your library for its Library ID and type it here.", "Apni library se Library ID maangein aur yahan daalein."] },
      { path: "/app/join", caption: ["Your request goes to the owner. Once approved you get a seat and a membership.", "Request owner ke paas jaati hai. Approve hone par seat aur membership milti hai."], scroll: 300 },
  ] },
  "student-security": { session: "student", group: "pages", dir: "student", name: "27-security", scenes: [
      { path: "/app/security", caption: ["Account and privacy: change your password and see your devices.", "Account aur privacy: password badlein aur devices dekhein."] },
      { path: "/app/security", caption: ["Sign out of all devices, download your data, or delete your account.", "Sabhi devices se logout, apna data download, ya account delete karein."], scroll: 450 },
  ] },
};
