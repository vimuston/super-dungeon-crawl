# Releasing on Google Play

The release workflow already builds what Play needs. Each run makes the Play
bundle `super-dungeon-crawl.aab` (the `android-play` workflow artifact) next
to the APK. It targets API 36 and has 16 KB aligned native code, which the
build checks. Everything else is one-time setup in the Play Console, below.

## 1. Developer account

- Sign up at <https://play.google.com/console/signup>: a one-time US$25 fee
  and identity verification (ID, and for organisations a D-U-N-S number).
- **Personal accounts** (created after 13 Nov 2023) must run a **closed test
  with at least 12 testers opted in for 14 days in a row** before they can
  apply for production access. Organisation accounts skip this. Plan for it:
  testers need a Google account and must stay opted in for the whole time.

## 2. Create the app

Play Console > Create app: name *Super Dungeon Crawl*, default language,
**Game**, **Free**. Accept the declarations. The package name is fixed by
the first upload: `com.superdungeoncrawl.app`. It can never change.

## 3. Signing (decide before the first upload)

Play re-signs every app with an *app signing key* and checks that your
uploads are signed with your *upload key*. Users who installed the GitHub
APK can only update to a Play build if both are signed with the same key.

- **Recommended: give Play your existing key.** At the first upload, under
  Play App Signing choose to use your own key, *Export and upload a key from
  Java keystore*, and follow its PEPK steps with the keystore behind the
  `ANDROID_KEYSTORE_*` secrets. Play then signs with the same key as the
  GitHub APKs, so players can move between them without reinstalling.
- **Or let Google generate the key.** Simpler, but Play installs and GitHub
  APK installs then can't update each other (export the save, uninstall,
  reinstall).

Either way keep the keystore and its passwords backed up somewhere safe. A
lost upload key can be reset through Play support; a lost app signing key
that you kept yourself cannot.

## 4. Store listing (Grow > Store presence > Main store listing)

| Item | Requirement |
|------|-------------|
| App name | ≤ 30 characters |
| Short description | ≤ 80 characters |
| Full description | ≤ 4000 characters |
| App icon | 512 × 512 PNG, 32-bit, ≤ 1 MB |
| Feature graphic | 1024 × 500 PNG or JPEG |
| Phone screenshots | 2–8, 16:9 or 9:16, 320–3840 px per side |
| Category | Games > Role Playing |
| Contact email | required, shown publicly |

Say in the description that this is an unofficial version **based on
Dungeon Crawl Stone Soup**, link the upstream project, and say the source is
GPL v2+ at this repository. Don't suggest the DCSS team made or endorses it.
That covers the GPL's source-availability terms and Play's impersonation
policy.

## 5. App content (Policy > App content)

- **Privacy policy**: required even though nothing is collected. Use
  <https://github.com/vimuston/super-dungeon-crawl/blob/main/PRIVACY.md>.
- **Ads**: no ads.
- **App access**: all functionality available without special access.
- **Content rating**: fill in the IARC questionnaire (fantasy violence,
  blood; no gambling, user interaction or purchases).
- **Target audience**: 13+ or 18+. Choosing under-13 ages pulls the app into
  the stricter Families policy.
- **Data safety**: *No data collected* and *no data shared*. The app has no
  analytics or ads and talks only to its own server on 127.0.0.1. Saves leave
  the device only when the player exports them.
- Government, financial, health, news: not applicable.

## 6. First upload and testing

1. Push a tag (`git tag v1.7.0 && git push origin v1.7.0`), or run *Release
   builds* by hand. Download the `android-play` artifact from the run.
2. Play Console > Test and release > Testing > **Internal testing** > Create
   release > upload `super-dungeon-crawl.aab`. Set up signing as in step 3.
   Add yourself as a tester and install it from the opt-in link to check it on
   a real phone, including the Back button and a save/resume.
3. **Closed testing** (personal accounts): create a closed track, add at least
   12 testers (an email list or a Google Group), roll out the same build and
   share the opt-in link. After 14 days, Dashboard > *Apply for production*.
4. **Production**: create a release (or promote the tested one), pick the
   countries, and send it for review. The first review can take several days.

Version codes must always grow. CI uses `<run number>0`, so every workflow run
makes a higher one than the last. Don't upload a locally built bundle (its
default version code is 3) after a CI one.

## 7. Uploading from CI (optional, after the first manual upload)

The Play API can't create an app, so the first upload must be manual. After
that:

1. Google Cloud Console: create a project, enable the *Google Play Android
   Developer API*, and create a service account with a JSON key.
2. Play Console > Users and permissions > Invite new users: add the service
   account's email with *Release apps to testing tracks* (and production if
   wanted) for this app.
3. Add the JSON as the repository secret `PLAY_SERVICE_ACCOUNT_JSON`:

   ```
   gh secret set PLAY_SERVICE_ACCOUNT_JSON < service-account.json
   ```

From then on every tag push uploads the bundle to the **internal** track as
a **draft**. Repository variables change that: `PLAY_TRACK` (`internal`,
`alpha` for closed testing, `beta`, `production`) and `PLAY_RELEASE_STATUS`
(`draft`, or `completed` to roll out at once; Play accepts only `draft` until
the app has been published).

## Keeping up with Play's rules

Each year from August, new apps and updates must target an API level from the
past year (API 36 today; expect 37 from August 2027). The bump is
`compileSdk`/`targetSdk` in `android/app/build.gradle` and the platform in
`scripts/build-android.sh init`. Read that Android version's behaviour
changes, as with API 36's predictive Back (see `MainActivity.registerBack`).
