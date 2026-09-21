# Home-page hero media — generation brief

The hero is the first screen on `/`. Its background clip and still are set in
**Admin → Branding & Tracking → Home-page hero**
(`site_settings.hero_video_url` / `hero_image_url`, see
`hero-media-migration.sql`), so replacing them is an upload, not a deploy.

This file is the brief for generating the replacements. The current pair reads
as a laboratory — benches, gloved hands, glassware, cold blue light — which
says "supplier" more than it says "why anyone cares". The direction below keeps
the credibility (the product is real, tested and clinical-grade) and moves the
*feeling* to the person it is for: someone in the middle of their own life,
early in the day, doing the ordinary things a body in good condition makes
easy.

---

## What the hero has to survive

The hero is a light, split layout — the headline, promise and buttons on the
left, the media on the right — so the media is a picture in a frame rather than
a backdrop under type:

- **It is not behind the copy.** Nothing is scrimmed and nothing is darkened.
  The media occupies the right half on desktop and sits above the copy when the
  layout stacks, so it is read on its own terms.
- **A light ground.** The section runs from white on the left to a soft
  Aqua/Mist wash on the right. Anything murky, heavily contrasted or night-lit
  fights that, so generate something **bright, airy and cool-neutral**.
- **A rounded panel, cropped to fill.** The still is drawn `object-cover` in a
  ~16:11 frame with a 2rem radius (4:3 on a phone), so keep the subject well
  inside the middle and leave air at every edge — the crop changes with the
  viewport.
- **Trust badges below.** A five-badge row closes the hero under both columns,
  which is another way of saying the frame is a panel, not a full screen.
- **The fallback is a product shot.** With no admin still set, the stage shows
  the featured compound's own vial render floating on the light wash. A
  generated still replaces that, so it should sit in the same palette.

---

## Video prompt

> Cinematic lifestyle footage, shot on a full-frame camera with a 35mm lens at
> f/2.0, natural morning light. A person in their late thirties moves through
> the unhurried start of an ordinary day in a warm, lived-in modern home: soft
> daylight through a wide window, a glass of water on a kitchen counter, a
> pair of running shoes by the door, steam lifting off a cup. Shallow depth of
> field, the background falling into gentle bokeh. The camera moves slowly and
> steadily — a slight dolly-in or lateral drift, no handheld shake, no cuts.
> Muted, warm-neutral palette: bone white, warm oak, soft grey-green, with one
> quiet teal accent in the surroundings. Skin tones natural and healthy, never
> glossy or retouched. The left third of the frame is calm negative space —
> an out-of-focus wall or window light — with the subject placed centre-right.
> Unhurried, grounded, capable, and bright throughout — the page around it is
> near-white. Realistic and documentary in feel, not an advertisement. No text, no logos, no product packaging, no clinical or
> laboratory setting, no lab coats, no syringes, no vials, no medical imagery.
> Seamless loop, 8–12 seconds, no audio.

**Technical**: H.264 MP4 (or WebM), 1920×1080 or wider, 24–30 fps, seamless
loop, audio track stripped, target under 2 MB — it loads over the still, so
weight costs more than resolution. Keep the last frame close to the first so
the loop does not visibly snap.

### Three variations worth generating

1. **Kitchen, morning.** Daylight, a glass of water being filled, hands and
   counter in focus, face partly out of frame. The most neutral of the three
   and the safest in the panel.
2. **Doorway, heading out.** Laces being tied or a jacket picked up, a hallway
   with light falling across it, movement out of frame toward the door.
   Reads as momentum without needing a gym.
3. **Outdoors, low sun.** A walk or a slow run along a tree-lined path or a
   shoreline, backlit, the subject small in frame with lots of air around
   them. The most "lifestyle" and the most likely to lose its subject once the
   panel crops it — check it at desktop and phone widths before choosing it.

---

## Still image prompt

The still carries the hero on phones, on slow connections and for anyone who
has asked for reduced motion, so it has to work on its own — not as a frame
grabbed mid-motion.

> Editorial lifestyle photograph, 35mm, f/2.0, natural morning window light.
> A warm, lived-in modern interior — pale oak, bone-white walls, a soft
> grey-green textile, a glass of water catching the light on a clean counter.
> A person is present but not posed and not the focus: a shoulder, a hand, a
> figure soft in the background. Shallow depth of field, gentle bokeh, bright
> warm-neutral grade with a single quiet teal accent. The subject sits near the
> centre with calm space around it on every side. Calm, healthy, unhurried. No text, no logos, no packaging, no laboratory or clinical
> setting, no medical equipment.

**Technical**: JPEG or WebP, 2400×1600 or larger, landscape, under ~400 KB
after compression. Pick a frame that still reads in a ~350px-wide panel — that
is all the stacked layout gives it on a phone.

---

## Before you publish

1. Upload the still in **Admin → Branding & Tracking → Home-page hero**, and
   paste the clip's URL into the video box beside it (the Supabase storage
   bucket the product images use is fine).
2. Check the home page at desktop width, at ~768px, and on a phone.
3. Look at it beside the headline. The copy sits next to the panel, not over
   it, so what to check is tone: anything dark or heavily saturated reads as a
   hole punched in a light page — regenerate rather than trying to correct for
   it in the panel.
4. Watch one full loop. A visible jump at the loop point is more distracting
   than no video at all; clear the video URL and run on the still if the clip
   cannot be made to loop cleanly.

---

## What to keep out

The site sells research-grade compounds, and the hero must not imply a human
therapeutic use or a clinical outcome. Keep out of both prompts:

- syringes, needles, injection, pills, IV lines, anything worn as a medical
  device;
- before/after framing, weight-loss or physique transformation cues,
  bodybuilding gyms;
- doctors, clinics, hospital settings, scrubs and lab coats — which is also the
  thing this brief is moving away from;
- any on-screen text, logo or packaging. The headline is rendered by the page,
  and generated lettering always comes out wrong.
