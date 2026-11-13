# Scale files (.scl)

Scala-format tuning files. Most come from the
[Huygens-Fokker Scala archive](https://www.huygens-fokker.org/microtonality/scales.html);
`khoomei_harmonics_8_16.scl` was authored in this repo. Each file is a small text file:
`!` lines are comments, followed by a description line, a pitch count, and the pitches
in cents or frequency ratios.

## Files

- **dudon_okna_hwt.scl** — "Harmonic well-temperament for mongolian lute". Jacques Dudon's
  harmonic temperament (*Synthese Orient-Occident*, 2005) for the Mongolian lute; keeps C:G
  pure (3/2) to suit the instrument's open tuning.
- **khoomei_harmonics_8_16.scl** — "Khoomei harmonics 8-16". Authored here: khoomei
  (Mongolian/Tuvan throat singing) filters single harmonics of a drone, so the sung melody
  is the harmonic-series segment 8:9:10:11:12:13:14:15:16.
- **persian.scl** — "Persian Tar Scale, from Dariush Anooshfar, TL 2-10-94". A 17-note
  just-intonation tuning of the Persian tar transcribed by Dariush Anooshfar.
- **persian-far.scl** — "Hormoz Farhat, average of observed Persian tar and sehtar tunings
  (1966)". Ethnomusicologist Hormoz Farhat's averaged cents measurements of real tar and
  sehtar tunings.
- **persian-far53.scl** — "Hormoz Farhat, pitches in The Dastgah Concept in Persian Music
  in 53-tET". The same material from Farhat's book, expressed in 53-tone equal temperament.
- **persian-vaz.scl** — "Vaziri's Persian tuning, using quartertones". Ali-Naqi Vaziri's
  early-20th-century 24-tET proposal for Persian music, with 50-cent quartertones.
- **iran_diat.scl** — "Iranian Diatonic from Dariush Anooshfar, Safi-a-ddin Armavi's scale
  from 125 ET". A 7-note diatonic derived from Safi al-Din al-Urmawi's 125-tone system by
  Anooshfar.
- **iranian pentachord 7-limit.scl** — "Iranian pentachord 42:45:48:56:63". A 7-limit
  just-intonation pentachord plus its continuation to the octave.
- **schulter_shur17.scl** — "Peppermint 17-note thirdtone set for Persian dastgah-ha".
  A 17-note set built on third-tones (thirdtone temperament) for the Persian dastgah
  repertoire.
- **chahargah3.scl** — "Iranian Chahargah, Julien J. Weiss". A 7-limit just-intonation
  tuning of dastgah Chahargah, transcribed by Julien J. Weiss.

## Using these files

Open one via the **Examples** page → **Open patch**, or via the scale dropdown →
**Import .scl file…** Imported scales are named by a hash of their content
(name, cents, period), so importing the same file again is idempotent — no duplicates
(see `src/engine/scala.ts`).
