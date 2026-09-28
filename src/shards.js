export const JOBS = [
  {
    id: "push",
    label: "Need a push",
    hint: "motivation when down",
    // Hand-authored 3D vibe: [grit, softness, people]. Teaching layer, not magic.
    vibe: [0.96, 0.14, 0.08],
    // What the photograph should feel like. Same 6 numbers as a fingerprint
    // in src/image.js: brightness, warmth, then four brightness bins (dark → bright).
    // Push likes daylight — a bit brighter, outdoor, not a warm lamp.
    // The picture is measured from its pixels on load. This prior is not.
    imagePrior: [0.68, 0.46, 0.06, 0.16, 0.36, 0.42],
    imageHint: "this job likes brighter, outdoor light",
    query:
      "I need a push. The day feels heavy. Remind me I can keep going, get out the door, finish the next small thing.",
  },
  {
    id: "soft",
    label: "Soft memory",
    hint: "gentle continuity",
    vibe: [0.1, 0.96, 0.12],
    // Soft likes a lamp more than noon: warmer, and a little dimmer.
    imagePrior: [0.36, 0.74, 0.32, 0.4, 0.2, 0.08],
    imageHint: "this job likes warmer, dimmer light",
    query:
      "I want a soft memory. Something gentle and ordinary. Quiet light, rain, a walk, the feeling of a good small life.",
  },
  {
    id: "people",
    label: "Prep for people & names",
    hint: "before you walk in",
    vibe: [0.08, 0.28, 0.96],
    // People sit in the middle: a room, not a noon ridge and not a night window.
    imagePrior: [0.52, 0.55, 0.14, 0.34, 0.34, 0.18],
    imageHint: "this job likes a middle light",
    query:
      "I'm about to see people. Help me remember names, what they care about, how they laugh, one true thing before I walk in.",
  },
];

// Flat pool — every job retrieves from all of these, then ranks.
export const SHARDS = [
  {
    id: "push-run",
    photo: "/photos/push-run.jpg",
    photoAlt: "A runner on an empty road in early light",
    date: "2021-04-11",
    note: "I didn’t want to go out this morning. I went anyway. By the third mile the heaviness had somewhere else to live. You already know how this works.",
    why: "When the day feels heavier than you are, this is proof you have moved through it before.",
    vibe: [0.94, 0.16, 0.05],
  },
  {
    id: "push-desk",
    photo: "/photos/push-desk.jpg",
    photoAlt: "A laptop open on a wooden desk in quiet indoor light",
    date: "2019-11-03",
    note: "We shipped it ugly and on time. I was sure it wasn’t enough. It was. Sleep, then do the next small thing.",
    why: "You asked for a push. Past-you already survived a night that felt like this one.",
    vibe: [0.82, 0.2, 0.18],
  },
  {
    id: "push-ridge",
    photo: "/photos/push-ridge.jpg",
    photoAlt: "A hiking trail along a mountain ridge under a wide sky",
    date: "2022-08-19",
    note: "Halfway up I wanted to turn around. The view wasn’t the point. Putting one foot in front of the other was.",
    why: "Motivation isn’t a feeling you wait for. You have practiced this.",
    vibe: [0.9, 0.28, 0.06],
  },
  {
    id: "soft-coffee",
    photo: "/photos/soft-coffee.jpg",
    photoAlt: "Morning light on a quiet kitchen counter",
    date: "2020-02-16",
    note: "Sunday. The light hit the counter just like this. I wrote nothing important. I was just here.",
    why: "Not a highlight. A texture. The kind of ordinary that still belongs to you.",
    vibe: [0.08, 0.96, 0.1],
  },
  {
    id: "soft-rain",
    photo: "/photos/soft-rain.jpg",
    photoAlt: "Rain on a window with a soft, grey outdoor world beyond",
    date: "2018-10-07",
    note: "I stayed in. The rain did the talking. I remember thinking: this is a good life, even when nothing is happening.",
    why: "Continuity isn’t made of milestones. This is a thread you can still hold.",
    vibe: [0.06, 0.94, 0.08],
  },
  {
    id: "soft-path",
    photo: "/photos/soft-path.jpg",
    photoAlt: "A sunlit path through tall trees",
    date: "2023-06-02",
    note: "Walked the long way home. No headphones. The neighborhood smelled like cut grass and someone cooking onions.",
    why: "A small return to the person who notices things.",
    vibe: [0.22, 0.86, 0.14],
  },
  {
    id: "people-dinner",
    photo: "/photos/people-dinner.jpg",
    photoAlt: "Friends talking across a café table",
    date: "2024-03-22",
    note: "Sam’s laugh is the loud one. He always asks about the thing you mentioned last time — even if you forgot you mentioned it. That’s the whole person.",
    why: "You’re about to see Sam. This is the texture, not the résumé.",
    vibe: [0.12, 0.32, 0.94],
  },
  {
    id: "people-cafe",
    photo: "/photos/people-cafe.jpg",
    photoAlt: "The corner of a quiet café, empty tables and warm lamps",
    date: "2023-01-14",
    note: "Mira prefers the corner table. She’ll tell you about her sister before she’ll tell you about work. Don’t lead with the project.",
    why: "Names stick when they come with a room and a habit.",
    vibe: [0.08, 0.4, 0.9],
  },
  {
    id: "people-table",
    photo: "/photos/people-table.jpg",
    photoAlt: "A long outdoor table of shared food in afternoon light",
    date: "2022-12-24",
    note: "Uncle Ray will ask if you’re eating enough. Answer yes, then ask about the garden. That’s the door he actually wants opened.",
    why: "Before the room fills up — one true thing about one person.",
    vibe: [0.16, 0.34, 0.88],
  },
  {
    id: "push-water",
    photo: "/photos/push-water.jpg",
    photoAlt: "A swimmer mid-stroke in a pool",
    date: "2021-09-04",
    note: "The water was colder than I wanted to admit. I got in anyway. Ten strokes later I was just a body doing the next stroke.",
    why: "You do not need to feel ready. You have already been the person who started.",
    vibe: [0.91, 0.22, 0.06],
  },
  {
    id: "soft-page",
    photo: "/photos/soft-page.jpg",
    photoAlt: "An open book, glasses, and a cup of coffee",
    date: "2019-03-28",
    note: "I read the same paragraph twice and didn’t mind. The room was warm. Nobody needed anything from me.",
    why: "A soft day is still a day that belongs to you.",
    vibe: [0.07, 0.93, 0.09],
  },
  {
    id: "people-porch",
    photo: "/photos/people-porch.jpg",
    photoAlt: "Friends sitting together looking out over water",
    date: "2023-08-11",
    note: "Jess is the one in yellow. She’ll ask how your week actually was before anyone talks about the view. Let her go first.",
    why: "Before the room fills up — one true thing about one person.",
    vibe: [0.1, 0.36, 0.91],
  },
];
