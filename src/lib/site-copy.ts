// Public website copy: English is the default, Hinglish (Hindi in English letters) is the toggle.
import type { SiteLang } from "./ui-store";

type Pair = { en: string; hi: string };
const p = (en: string, hi: string): Pair => ({ en, hi });
export const say = (lang: SiteLang, pair: Pair) => pair[lang];

export const copy = {
  nav: {
    home: p("Home", "Home"),
    owners: p("For library owners", "Library owners ke liye"),
    students: p("For students", "Students ke liye"),
    how: p("How it works", "Kaise kaam karta hai"),
    soon: p("Coming soon", "Jaldi aa raha hai"),
    pricing: p("Pricing", "Pricing"),
    guide: p("Video guide", "Video guide"),
    find: p("Find a library", "Library dhoondhein"),
    login: p("Log in", "Log in"),
    start: p("Get started", "Shuru karein"),
  },
  home: {
    eyebrow: p(
      "Software for study libraries",
      "Study libraries ke liye software",
    ),
    titleA: p("Run your library with ", "Library chalao "),
    titleEm1: p("ease", "aasaani"),
    titleB: p(". Help students study ", " se. Students padhein "),
    titleEm2: p("every day", "roz"),
    lede: p(
      "StudyQuest handles seats, shifts, fees, attendance and reports in one place. Students get a focus timer, XP, quests and exam prep, so they keep coming back and renew their membership.",
      "StudyQuest seats, shifts, fees, attendance aur reports ek jagah sambhalta hai. Students ko milta hai focus timer, XP, quests aur exam prep, taaki woh roz aayein aur membership renew karein.",
    ),
    ctaOwner: p("I run a library", "Meri library hai"),
    ctaStudent: p("I'm a student", "Main student hoon"),
    facts: [
      ["25 min", p("focus sessions", "ka focus session")],
      ["100 m", p("location check", "location check")],
      ["10 min", p("desk QR code", "wala desk QR")],
      ["56", p("video guides", "video guides")],
    ] as [string, Pair][],
    ownerEyebrow: p("Library owner · admin", "Library owner · admin"),
    ownerTitle: p(
      "No more registers, calculators and WhatsApp groups.",
      "Register, calculator aur WhatsApp groups ki chhutti.",
    ),
    ownerGo: p("See all 29 owner screens", "Saare 29 owner screens dekhein"),
    studentEyebrow: p("Student · app", "Student · app"),
    studentTitle: p(
      "More than a seat. A study partner.",
      "Seat se zyada. Padhai ka saathi.",
    ),
    studentGo: p(
      "See all 27 student screens",
      "Saare 27 student screens dekhein",
    ),
    strip: [
      [
        "/how-it-works",
        p("How it works", "Kaise kaam karta hai"),
        p(
          "From joining with a Library ID to a fee receipt, in 5 steps.",
          "Library ID se join karne se fees receipt tak, 5 steps mein.",
        ),
      ],
      [
        "/coming-soon",
        p("Coming soon", "Jaldi aa raha hai"),
        p(
          "Reminders by SMS and WhatsApp, online fee payment and more.",
          "SMS aur WhatsApp reminders, online fees payment aur bahut kuch.",
        ),
      ],
      [
        "/guide",
        p("56 video guides", "56 video guides"),
        p(
          "Every screen explained in a short video with Hindi audio.",
          "Har screen ek chhote video mein, Hindi audio ke saath.",
        ),
      ],
    ] as [string, Pair, Pair][],
  },
  seat: {
    title: p("Seat map", "Seat map"),
    sub: p(
      "Ground floor · seats A01–A48 · sample data",
      "Ground floor · seats A01–A48 · sample data",
    ),
    morning: p("Morning 06–12", "Subah 06–12"),
    evening: p("Evening 16–22", "Shaam 16–22"),
    free: p("Free", "Khaali"),
    booked: p("Booked", "Booked"),
    repair: p("Under repair", "Repair mein"),
    filled: p("Filled this shift", "Is shift mein bhari"),
    freeCount: p("Free seats", "Khaali seats"),
    dues: p("Fees due", "Fees baaki"),
  },
  ownerWins: [
    p(
      "Set up in minutes, never a double booking",
      "Setup kuch minute mein, double booking kabhi nahi",
    ),
    p("A digital receipt for every payment", "Har payment ki digital receipt"),
    p(
      "Live attendance with location or QR checks",
      "Live attendance, location ya QR check ke saath",
    ),
    p(
      "Real profit reports without a calculator",
      "Asli profit report, bina calculator",
    ),
  ],
  studentWins: [
    p(
      "Seat, fees and receipts always on your phone",
      "Seat, fees aur receipts hamesha phone mein",
    ),
    p(
      "Server-verified study time and streaks",
      "Server par verify hota study time aur streak",
    ),
    p("Quests, badges and real rewards", "Quests, badges aur asli rewards"),
    p(
      "Mock tests, smart revision and a planner",
      "Mock tests, smart revision aur planner",
    ),
  ],
  owners: {
    title: p(
      "Everything a library owner needs, in one dashboard.",
      "Library owner ki har zaroorat, ek dashboard mein.",
    ),
    lede: p(
      "The admin (library owner) runs seats, students, money and staff from one place. Each feature below says what it does for your business.",
      "Admin (library owner) seats, students, paisa aur staff ek jagah se chalata hai. Har feature ke saath likha hai ki aapke business ko kya fayda hai.",
    ),
    asideTitle: p("Why owners switch", "Owners kyun badalte hain"),
    asideText: p(
      "Less admin work every day, fewer fee disputes, and students who stay longer.",
      "Roz ka kaam kam, fees par jhagde kam, aur students zyada din tak rukte hain.",
    ),
    asideCta: p("See how it works", "Dekhiye kaise kaam karta hai"),
  },
  students: {
    title: p(
      "An app that helps you study every day.",
      "Ek app jo roz padhne mein madad karta hai.",
    ),
    lede: p(
      "The student app connects you to your library and builds a daily study habit. Each feature below says how it helps you.",
      "Student app aapko library se jodta hai aur roz padhne ki aadat banata hai. Har feature ke saath likha hai ki aapko kya fayda hai.",
    ),
    asideTitle: p("Why students love it", "Students ko kyun pasand hai"),
    asideText: p(
      "Your progress is visible, your effort is rewarded, and your library is one tap away.",
      "Progress dikhti hai, mehnat ka inaam milta hai, aur library ek tap door.",
    ),
    asideCta: p("See a day in the library", "Library ka ek din dekhein"),
  },
  how: {
    title: p(
      "A day in the library, step by step.",
      "Library ka ek din, step by step.",
    ),
    lede: p(
      "This order is real: each step depends on the one before it.",
      "Yeh order asli hai: har kadam pichhle par tika hai.",
    ),
    note: p(
      "Every one of the 56 screens has a short video guide with Hindi audio, so owners, staff and students learn without training.",
      "Saare 56 screens ka chhota video guide hai, Hindi audio ke saath, taaki owner, staff aur students bina training seekh lein.",
    ),
    noteCta: p("Open the video guide", "Video guide kholein"),
  },
  soon: {
    title: p("What we are building next.", "Aage hum kya bana rahe hain."),
    lede: p(
      "These features are on the roadmap. Some are already coded and only need outside setup; each card says how far it has come.",
      "Yeh features roadmap par hain. Kuch ka code taiyaar hai aur bas bahari setup baaki hai; har card par likha hai ki kahan tak pahuncha.",
    ),
  },
  cta: {
    title: p(
      "Bring your library online today.",
      "Apni library aaj hi online laaiye.",
    ),
    text: p(
      "The free plan needs no card, and every screen comes with a video guide.",
      "Free plan mein koi card nahi chahiye, aur har screen ka video guide saath mein.",
    ),
    owner: p("Start as an owner", "Owner ke roop mein shuru"),
    student: p("Join as a student", "Student ke roop mein judein"),
  },
  footer: p(
    "Made for the person you're becoming.",
    "Us insaan ke liye jo aap ban rahe hain.",
  ),
};

/** Feature groups: [group name, [feature name, benefit][]] with English and Hinglish. */
export type FeatureGroup = { name: Pair; items: { name: Pair; text: Pair }[] };
const g = (
  name: Pair,
  items: [string, string, string, string][],
): FeatureGroup => ({
  name,
  items: items.map(([ne, te, nh, th]) => ({
    name: p(ne, nh),
    text: p(te, th),
  })),
});

export const ownerFeatures: FeatureGroup[] = [
  g(p("Setup", "Setup"), [
    [
      "Setup guide",
      "Get your library online in 8 saved steps.",
      "Setup guide",
      "8 steps mein library online, har step save.",
    ],
    [
      "Shifts",
      "Morning and evening slots, so one seat sells twice a day.",
      "Shifts",
      "Subah aur shaam ke slot; ek seat din mein do baar.",
    ],
    [
      "Seat map",
      "See free and booked seats at a glance.",
      "Seat map",
      "Kaunsi seat khaali, kaunsi bhari, ek nazar mein.",
    ],
    [
      "Fee plans",
      "Plans like Monthly ₹1,200 for 30 days.",
      "Fee plans",
      "Monthly ₹1,200 jaise plans, 30 din ke liye.",
    ],
    [
      "Branches",
      "Several libraries in one account, each with its own books.",
      "Branches",
      "Kai library ek account se, har branch ka alag hisaab.",
    ],
    [
      "Settings and staff",
      "Limited staff access and a record of every change.",
      "Settings aur staff",
      "Staff ko seemit access, har badlaav ka record.",
    ],
  ]),
  g(p("Students and admissions", "Students aur admissions"), [
    [
      "Join requests",
      "Share your Library ID; students join, you approve.",
      "Join requests",
      "Library ID share karo, student khud jude, aap approve karo.",
    ],
    [
      "Students",
      "Every student in one searchable list.",
      "Students",
      "Saare students ek list mein, khoj ke saath.",
    ],
    [
      "Memberships",
      "Renew, pause or cancel; a paused member keeps the seat.",
      "Memberships",
      "Renew, pause, cancel; pause par seat reserve.",
    ],
    [
      "Public listing",
      "A public page where new students find you.",
      "Public listing",
      "Online page jahan naye students aapko dhoondhein.",
    ],
    [
      "Waitlist",
      "Keep future students even when you are full.",
      "Waitlist",
      "Library bhari ho tab bhi student line mein rahe.",
    ],
    [
      "Admissions CRM",
      "Follow up every enquiry and win more admissions.",
      "Admissions CRM",
      "Har enquiry ka follow-up, zyada admissions.",
    ],
    [
      "Register import",
      "Bring in your paper register from a CSV.",
      "Register import",
      "Purana register CSV se, galti pehle dikhegi.",
    ],
  ]),
  g(p("Daily operations", "Roz ka kaam"), [
    [
      "Dashboard",
      "Revenue, students, seats and dues on one screen.",
      "Dashboard",
      "Kamaai, students, seats aur dues ek screen par.",
    ],
    [
      "Attendance",
      "A desk QR that changes every 10 minutes.",
      "Attendance",
      "Har 10 minute badalne wala desk QR.",
    ],
    [
      "Live presence",
      "See who is inside right now, from anywhere.",
      "Live presence",
      "Ghar baithe dekho abhi kaun andar hai.",
    ],
    [
      "Complaints",
      "Every concern in writing, with its status.",
      "Complaints",
      "Har shikayat likhit mein, status ke saath.",
    ],
    [
      "Maintenance",
      "Broken seats stay out of booking until fixed.",
      "Maintenance",
      "Kharaab seat repair tak booking se bahar.",
    ],
    [
      "Announcements",
      "Reach every student at once.",
      "Announcements",
      "Sabhi students ko ek saath soochna.",
    ],
  ]),
  g(p("Money", "Paisa"), [
    [
      "Payments",
      "Record cash or UPI and send a digital receipt.",
      "Payments",
      "Cash ya UPI darj karo, digital receipt turant.",
    ],
    [
      "Expenses",
      "Rent, electricity and salaries in one place.",
      "Expenses",
      "Kiraya, bijli, salary ek jagah.",
    ],
    [
      "Reports",
      "A 6-month chart of profit and seat use.",
      "Reports",
      "6 mahine ka chart, profit aur seat use.",
    ],
    [
      "Billing",
      "Start free; your data is never deleted.",
      "Billing",
      "Free se shuru, data kabhi delete nahi.",
    ],
  ]),
  g(p("Engagement and safety", "Engagement aur safety"), [
    [
      "Rewards",
      "Reward regular students within a budget you set.",
      "Rewards",
      "Study Coins se inaam, budget aapke haath mein.",
    ],
    [
      "Events",
      "Mock-test days and seminars in students' apps.",
      "Events",
      "Mock test day aur seminar students ke app mein.",
    ],
    [
      "Feedback",
      "Private feedback from students.",
      "Feedback",
      "Students ki private raay.",
    ],
    [
      "Community safety",
      "Review reports and record guardian consent.",
      "Community safety",
      "Reports ka faisla, guardian ki sehmati.",
    ],
  ]),
];

export const studentFeatures: FeatureGroup[] = [
  g(p("Library life", "Library life"), [
    [
      "Join a library",
      "Enter the Library ID; the owner approves you.",
      "Library join",
      "Library ID daalo, owner approve karega.",
    ],
    [
      "My library",
      "Seat number, fees due and every receipt.",
      "My library",
      "Seat number, fees baaki aur har receipt.",
    ],
    [
      "Punch in / out",
      "One tap, only from within 100 m.",
      "Punch in / out",
      "Ek tap, 100 m ke andar se hi.",
    ],
    [
      "Notifications",
      "Every library update without group chats.",
      "Notifications",
      "Library ki har soochna, bina group ke.",
    ],
    [
      "Report an issue",
      "Report a fan, light or seat problem.",
      "Report an issue",
      "Pankha, light, seat ki shikayat.",
    ],
    [
      "Events and feedback",
      "Library events and a private way to share ideas.",
      "Events aur feedback",
      "Library events aur apni raay.",
    ],
    [
      "Library requests",
      "Track visit and waitlist requests.",
      "Library requests",
      "Visit aur waitlist ka status.",
    ],
  ]),
  g(p("Daily study", "Roz ki padhai"), [
    [
      "Focus room",
      "A 25-minute timer; each session gives +10 XP.",
      "Focus room",
      "25 minute timer, har session +10 XP.",
    ],
    [
      "Quests",
      "Small goals, up to 100 XP a day.",
      "Quests",
      "Chhote target, roz zyada se zyada 100 XP.",
    ],
    [
      "Progress",
      "Hours studied each day, on a chart.",
      "Progress",
      "Har din kitne ghante, chart mein.",
    ],
    [
      "Achievements",
      "Badges and levels for steady work.",
      "Achievements",
      "Badges aur level, lambi mehnat ka inaam.",
    ],
    [
      "Study garden",
      "A plant that grows when you study regularly.",
      "Study garden",
      "Niyamit padhai se badhta paudha.",
    ],
    [
      "Profile and rest days",
      "Two rest days a week keep your streak safe.",
      "Profile aur rest day",
      "Hafte mein 2 rest day, streak safe.",
    ],
  ]),
  g(p("Exam preparation", "Exam ki taiyari"), [
    [
      "Exam roadmap",
      "Your syllabus as checkpoints.",
      "Exam roadmap",
      "Syllabus checkpoints mein.",
    ],
    [
      "Mock tests",
      "Timed tests scored on the server.",
      "Mock tests",
      "Timer wale test, server par score.",
    ],
    [
      "Quiz arena",
      "Quick practice with no penalty for mistakes.",
      "Quiz arena",
      "Jaldi practice, galti par saza nahi.",
    ],
    [
      "Smart revision",
      "Reminds you just before you forget.",
      "Smart revision",
      "Bhoolne se pehle yaad dilata hai.",
    ],
    [
      "Learning insights",
      "Weak topics, from your real results.",
      "Learning insights",
      "Kamzor topics, asli results se.",
    ],
    [
      "Study planner",
      "A timetable that fits your real week.",
      "Study planner",
      "Asli hafte ke hisaab se timetable.",
    ],
    [
      "Doubt solver",
      "Ask by text or photo and get hints.",
      "Doubt solver",
      "Text ya photo se sawaal, hints ke saath.",
    ],
  ]),
  g(p("Friends and rewards", "Saath aur inaam"), [
    [
      "Rewards",
      "Spend Study Coins on library rewards.",
      "Rewards",
      "Study Coins se library ke inaam.",
    ],
    [
      "Friends",
      "Challenges with friends you choose.",
      "Friends",
      "Chune hue doston ke saath challenges.",
    ],
    [
      "Focus rooms",
      "Study together, with no chat.",
      "Focus rooms",
      "Saath padho, bina chat ke.",
    ],
    [
      "Community",
      "Groups under an alias; your real name stays private.",
      "Community",
      "Upnaam se groups, asli naam kabhi nahi.",
    ],
    [
      "Share",
      "A milestone card without private details.",
      "Share",
      "Uplabdhi card, private jaankari ke bina.",
    ],
  ]),
];

export const dayFlow: { who: Pair; title: Pair; text: Pair; tag: string }[] = [
  {
    who: p("Student", "Student"),
    title: p("Join with the Library ID", "Library ID se join"),
    text: p(
      "Got the ID at the desk, typed it in the app, request sent.",
      "Counter se ID lekar app mein daali, request chali gayi.",
    ),
    tag: "LIB-AB12CD",
  },
  {
    who: p("Owner", "Owner"),
    title: p("A seat in one click", "Ek click mein seat"),
    text: p(
      "Picked a seat, shift and plan, then approved. Membership ready.",
      "Seat, shift, plan chuna aur Approve. Membership taiyaar.",
    ),
    tag: "A12 · Morning",
  },
  {
    who: p("Student", "Student"),
    title: p("Punch in", "Punch in"),
    text: p(
      "One tap from inside the library. No fake punch-ins from home.",
      "Library ke andar se ek tap. Ghar se jhootha punch in nahi.",
    ),
    tag: "≤ 100 m",
  },
  {
    who: p("Student", "Student"),
    title: p("Focus session", "Focus session"),
    text: p(
      "25 minutes of focused study, timed on the server.",
      "25 minute dhyaan se padhai, server par gina samay.",
    ),
    tag: "+10 XP",
  },
  {
    who: p("Owner", "Owner"),
    title: p("Fees and receipt", "Fees aur receipt"),
    text: p(
      "Recorded cash or UPI; the receipt appears in the student's app.",
      "Cash ya UPI darj kiya, student ke app mein receipt.",
    ),
    tag: "₹1,200 · RCPT",
  },
];

export const comingSoon: {
  for: Pair[];
  stage: Pair;
  title: Pair;
  text: Pair;
  gain: Pair;
}[] = [
  {
    for: [p("Owner", "Owner"), p("Student", "Student")],
    stage: p("Needs SMS/email provider", "Provider setup baaki"),
    title: p(
      "SMS, WhatsApp and email reminders",
      "SMS, WhatsApp aur email reminders",
    ),
    text: p(
      "Fee-due and membership-ending reminders outside the app too.",
      "Fees due aur membership khatam hone ka reminder app ke bahar bhi.",
    ),
    gain: p(
      "Students who never open the app still get reminded on time.",
      "Jo student app nahi kholta, use bhi time par yaad aa jaye.",
    ),
  },
  {
    for: [p("Student", "Student"), p("Owner", "Owner")],
    stage: p("Coded · needs live keys", "Code taiyaar · keys baaki"),
    title: p("Pay fees online in the app", "App se online fees payment"),
    text: p(
      "Students pay fees straight from the app (Razorpay). Already tested.",
      "Student seedha app se fees bhare (Razorpay). Test ho chuka hai.",
    ),
    gain: p(
      "No more cash hassle, and fees arrive on time.",
      "Cash ki jhanjhat khatam, fees time par.",
    ),
  },
  {
    for: [p("Owner", "Owner")],
    stage: p("Planning", "Planning"),
    title: p("Attendance updates for parents", "Parents ko attendance update"),
    text: p(
      "A message to parents about their child's attendance, with their permission.",
      "Bachche ki haazri ka message parents ko, unki permission ke saath.",
    ),
    gain: p(
      "Builds trust for libraries with school students.",
      "School ke bachchon wali libraries ka bharosa badhega.",
    ),
  },
  {
    for: [p("Owner", "Owner"), p("Student", "Student")],
    stage: p("Before launch", "Launch se pehle"),
    title: p("Two-step login", "Two-step login"),
    text: p(
      "An extra code with your password to keep accounts and fee data safer.",
      "Password ke saath ek extra code, taaki account aur fees data surakshit rahe.",
    ),
    gain: p(
      "Your account stays safe even if a password leaks.",
      "Password leak ho, tab bhi account safe.",
    ),
  },
  {
    for: [p("Student", "Student")],
    stage: p("In design", "Design mein"),
    title: p("Visual syllabus map", "Picture wala syllabus map"),
    text: p(
      "The exam syllabus is a list today; next it becomes a visual map.",
      "Exam syllabus abhi list mein hai; aage yeh visual naqsha banega.",
    ),
    gain: p(
      "See at a glance how much you have covered.",
      "Ek nazar mein dikhega kitna cover hua.",
    ),
  },
];
