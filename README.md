# GitHub Activity in Readme

Updates `README.md` with the recent GitHub activity of a user.

<img width="735" alt="profile-repo" src="https://user-images.githubusercontent.com/25279263/87703301-3aa4a500-c7b8-11ea-8eb6-245121997a7b.png">

---

## Instructions

- Add the comment `<!--START_SECTION:activity-->` (entry point) within `README.md`. You can find an example [here](https://github.com/jamesgeorge007/jamesgeorge007/blob/master/README.md).

- Create a [personal access token](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token) with `repo` scope and store it as a [secret](https://docs.github.com/en/actions/configuring-and-managing-workflows/creating-and-storing-encrypted-secrets) with the name **GH_PAT** in the repo settings.

- It's the time to create a workflow file.

`.github/workflows/update-readme.yml`

```yml
name: Update README

on:
  schedule:
    - cron: '*/30 * * * *'

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2
      - uses: jamesgeorge007/github-activity-readme@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_PAT: ${{ secrets.GH_PAT }}
          GH_USERNAME: <username>
```

The above job runs every half an hour, you can change it as you wish based on the [cron syntax](https://jasonet.co/posts/scheduled-actions/#the-cron-syntax).

You can find an example [here](https://github.com/jamesgeorge007/jamesgeorge007/blob/master/.github/workflows/update-readme.yml).

_Inspired by [JasonEtco/activity-box](https://github.com/JasonEtco/activity-box)_
