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
};
