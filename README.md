# GitHub Activity in Readme

Updates `README.md` with the recent GitHub activity of a user.

<img width="735" alt="profile-repo" src="https://user-images.githubusercontent.com/25279263/87703301-3aa4a500-c7b8-11ea-8eb6-245121997a7b.png">

---

## Instructions

- Add the comment `<!--START_SECTION:activity-->` (entry point) within `README.md`. You can find an example [here](https://github.com/jamesgeorge007/jamesgeorge007/blob/master/README.md).

- It's the time to create a workflow file.

`.github/workflows/update-readme.yml`

```yml
name: Update README

on:
  schedule:
    - cron: '*/30 * * * *'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    name: Update this repo's README with recent activity

    steps:
      - uses: actions/checkout@v2
      - uses: jamesgeorge007/github-activity-readme@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The above job runs every half an hour, you can change it as you wish based on the [cron syntax](https://jasonet.co/posts/scheduled-actions/#the-cron-syntax).

Please note that only those public events that belong to the following list show up:-

- `IssueEvent`
- `IssueCommentEvent`
- `PullRequestEvent`

You can find an example [here](https://github.com/jamesgeorge007/jamesgeorge007/blob/master/.github/workflows/update-readme.yml).

### Override defaults

Use the following `input params` to customize it for your use case:-

| Input Param | Default Value | Description |
|--------|--------|--------|
| `COMMIT_MSG` | :zap: Update README with the recent activity | Commit message used while committing to the repo |
| `MAX_LINES` | 5 | The maximum number of lines populated in your readme file |


```yml
name: Update README

on:
  schedule:
    - cron: '*/30 * * * *'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    name: Update this repo's README with recent activity

    steps:
      - uses: actions/checkout@v2
      - uses: jamesgeorge007/github-activity-readme@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          COMMIT_MSG: 'Specify a custom commit message'
          MAX_LINES: 10
```

_Inspired by [JasonEtco/activity-box](https://github.com/JasonEtco/activity-box)_
