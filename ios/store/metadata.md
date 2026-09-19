# App Store Connect: what to paste where

Every field App Store Connect asks for, written out, so the submission is a
copy-and-paste rather than a writing session at the moment you least want one.
Limits are Apple's and are counted, not estimated:
`engines/hypnopompia/tools/check-metadata.mjs` fails if any field here is over.
Each field is the indented block under its heading and is pasted exactly as it
stands, line breaks included, so the single-line fields are single lines here
however long that makes them.

Nothing in here may promise something the build does not do. Two claims in
particular are load-bearing and are checked by the build itself: the app makes
no network requests, and it has no ads, tracking, accounts or purchases. See
`ios/AGENTS.md` if either ever changes.

---

## Name (30)

    makemecookies!x4: Cookie Rush

The game's own name is `makemecookies!x4`, which nobody will ever search for;
"Cookie Rush" is what somebody types. RUSH is also the game's own word for
its four double-score windows, so the name is not borrowing a genre word it has
no claim on.
Alternative if a shorter name is ever wanted: `makemecookies!x4`.

## Subtitle (30)

    Five stations, one song

## Category

Primary **Games › Arcade**. Secondary **Games › Simulation**.

Puzzle is the wrong call here and is worth saying out loud, because the other
magmacrunch game on the store is one. Nothing in this game is solved; it is
reaction under time pressure, and the shift is over when the song is.

## Promotional text (170)

Editable without a new build, so this is the field to change for a sale, an
update or a mention.

    One song long. Five machines that will not wait for you. Ship as many cookies as you can before the whistle, and see how much mess you left behind.

## Description (4000)

    A shift is one play of the song, and the song is the clock.

    Flour into the hopper. Dough out of the mixer, before it toughens. Along
    the belt, unstick it when it jams. Out of the oven the moment it turns
    golden, not after. Into a box, and the bigger the box the better it pays.

    Five machines, all running at once, none of them waiting for you. The
    difficulty is not any one station. It is that your hands can only be in
    one place, and the oven does not care where they are.

    THE SHIFT

    Tap a station to act on it, or use the keys 1 to 5. Every station has one
    moment that is right and a slow slide into something worse: dough
    overmixes, trays burn and then catch fire, the hopper overfills and goes
    on the floor. Nothing blocks you. Everything degrades.

    Four RUSH windows land on the music, the belt speeds up and every box
    scores double. The song is called x4 and gets four of them.

    Mess builds from every spill, every burnt tray and every second the oven
    is alight. Fill the meter and the health inspector arrives, the line
    freezes for four seconds, and the song keeps playing. That is the whole
    penalty, and it is the only failure in the game.

    NO LOSING

    There is no game over and nothing to fail. A shift ends when the song
    does, and it is scored on what you shipped and what you left behind: one
    star at 8 cookies, two at 15, three at 22. Finish clean and the clean-up
    bonus is worth more than most boxes.

    WHAT IS IN IT

    - One song, one shift, about fifty seconds of it
    - Five stations, each with its own way of going wrong
    - Four RUSH windows, on the beat
    - A star rating set from what quick hands can actually manage
    - Game Center leaderboard and achievements, entirely optional
    - Haptics on every box, spill, fire and whistle

    OFFLINE, AND NOT ASKING FOR ANYTHING

    No ads. No tracking. No account. No purchases. No network connection of
    any kind: every pixel, sound and note is in the app, and it plays the same
    in airplane mode.

    The song is "makemecookies! x4." by Jimmi, on magmacrunch media. The game
    is named after the song, not the other way round.

## Keywords (100)

Comma-separated, no spaces: a space costs a character and buys nothing.

The two names in the line below are deliberately absent from the keywords.
This game owes the genre, which is not the same as owing an app, and bidding on
another app's name in the keyword field is read differently from a nod in the
credits. `check-metadata.mjs` lives in the hypnopompia repo and cannot know one
game's facts, so the forbidden words are declared here.

<!-- forbid-keywords: overcooked, diner dash -->


    cookie,bakery,factory,kitchen,oven,belt,arcade,timing,reaction,frantic,rhythm,retro,pixel,offline

## What's New (4000)

For 1.0 this field is not shown, so it only matters from the first update. The
1.0 text, if a version of it is wanted:

    First release.

## Support URL

    https://magmacrunch.com/support/makemecookies/

## Marketing URL

    https://magmacrunch.com/arcade/makemecookies/

The browser version, which is the honest "learn more" page and also shows a
reviewer the game is not a repackaged template.

## Copyright

    2026 magmacrunch media

## Age rating

Everything **None** / **No**, which gives **4+**. Three answers are worth
being deliberate about:

- **Simulated Gambling: None.** A score leaderboard is not gambling, and this
  is the question score games get wrong.
- **User Generated Content: No.** The chat widget the website carries is
  dropped from this bundle, which is what makes the answer clean. The initials
  entered on the end-of-shift card never leave the device.
- **Unrestricted Web Access: No.** There is no browser in the app; the one
  credits link opens Safari.

Do **not** opt into the Kids Category: Game Center is not permitted there.

## App privacy

**Do you collect data? No.** One question, one answer. Game Center data goes
to Apple under the player's own account, not to us, and `localStorage` never
leaves the device. Privacy Policy URL is
`https://magmacrunch.com/privacy/makemecookies/`. Both are per-app: `/privacy/`
and `/support/` are indexes, so a third app gets its own pages rather than
editing these.

## Export compliance

`ITSAppUsesNonExemptEncryption` is already `false` in `Info.plist`, so App
Store Connect stops asking on every upload.

## Music rights

Not a field, and worth having written down before anybody asks. The song is
magmacrunch media's own: `NOTICE` records it as a magmacrunch media record
label act, Copyright 2026 magmacrunch media, all rights reserved. The
repository's PolyForm Noncommercial licence deliberately does not cover it,
which is a restriction on other people rather than on this app.

## Review notes

The reviewer's likely objection is guideline 4.2, a web game in a wrapper, so
this answers it before it is raised, in the reviewer's own terms.

    makemecookies!x4 is fully playable offline and needs no account, no
    sign-in and no network connection. The app makes no network requests of
    any kind: every asset is in the bundle, and our build fails if any asset
    references an external URL.

    Native integration: Game Center for the leaderboard and achievements, the
    Taptic Engine for feedback on every box shipped, spill, oven fire and
    end-of-shift whistle, and a safe-area layout that keeps the controls and
    the buttons clear of the notch and the home indicator.

    Game Center is optional. The game is identical if you decline the sign-in
    prompt; best shifts are then kept on the device only, so there is no need
    to sign in to review the app.

    To see the whole game quickly: tap CLOCK IN, then tap any of the five
    machines along the bottom, or use the number keys 1 to 5 on a keyboard. A
    shift lasts one play of the song, about fifty seconds, and ends by itself.
    Tapping the oven the moment its tray turns golden, then tapping packing,
    ships your first box.

    The song is our own recording, on our own label, and the game is named
    after it.
