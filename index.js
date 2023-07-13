const core = require("@actions/core");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Toolkit } = require("actions-toolkit");

// Get config
const GH_USERNAME = core.getInput("GH_USERNAME");
const COMMIT_NAME = core.getInput("COMMIT_NAME");
const COMMIT_EMAIL = core.getInput("COMMIT_EMAIL");
const COMMIT_MSG = core.getInput("COMMIT_MSG");
const MAX_LINES = core.getInput("MAX_LINES");
const TARGET_FILE = core.getInput("TARGET_FILE");

/**
 * Returns the sentence case representation
 * @param {String} str - the string
 *
 * @returns {String}
 */

const capitalize = (str) => str.slice(0, 1).toUpperCase() + str.slice(1);

/**
 * Returns a URL in markdown format for PR's and issues
 * @param {Object | String} item - holds information concerning the issue/PR
 *
 * @returns {String}
 */

const toUrlFormat = (item) => {
  if (typeof item !== "object") {
    return `[${item}](https://github.com/${item})`;
  }

  if (Object.hasOwnProperty.call(item.payload, "comment")) {
    return `[#${item.payload.issue.number}](${item.payload.comment.html_url})`;
  }

  if (Object.hasOwnProperty.call(item.payload, "issue")) {
    return `[#${item.payload.issue.number}](${item.payload.issue.html_url})`;
  }

  if (Object.hasOwnProperty.call(item.payload, "pull_request")) {
    return `[#${item.payload.pull_request.number}](${item.payload.pull_request.html_url})`;
  }

  if (Object.hasOwnProperty.call(item.payload, "release")) {
    const release = item.payload.release.name
      ? item.payload.release.name
      : item.payload.release.tag_name;
    return `[${release}](${item.payload.release.html_url})`;
  }
};

/**
 * Execute shell command
 * @param {String} cmd - root command
 * @param {String[]} args - args to be passed along with
 *
 * @returns {Promise<void>}
 */

const exec = (cmd, args = []) =>
  new Promise((resolve, reject) => {
    const app = spawn(cmd, args, { stdio: "pipe" });
    let stdout = "";
    app.stdout.on("data", (data) => {
      stdout = data;
    });
    app.on("close", (code) => {
      if (code !== 0 && !stdout.includes("nothing to commit")) {
        err = new Error(`Invalid status code: ${code}`);
        err.code = code;
        return reject(err);
      }
      return resolve(code);
    });
    app.on("error", reject);
  });

/**
 * Make a commit
 *
 * @returns {Promise<void>}
 */

const commitFile = async () => {
  await exec("git", ["config", "--global", "user.email", COMMIT_EMAIL]);
  await exec("git", ["config", "--global", "user.name", COMMIT_NAME]);
  await exec("git", ["add", TARGET_FILE]);
  await exec("git", ["commit", "-m", COMMIT_MSG]);
  await exec("git", ["push"]);
};

const serializers = {
  IssueCommentEvent: (item) => {
    return `🗣 Commented on ${toUrlFormat(item)} in ${toUrlFormat(
      item.repo.name
    )}`;
  },
  IssuesEvent: (item) => {
    const emoji = item.payload.action === "opened" ? "❗" : "🔒";
    return `${emoji} ${capitalize(item.payload.action)} issue ${toUrlFormat(
      item
    )} in ${toUrlFormat(item.repo.name)}`;
  },
  PullRequestEvent: (item) => {
    const emoji = item.payload.action === "opened" ? "💪" : "❌";
    const line = item.payload.pull_request.merged
      ? "🎉 Merged"
      : `${emoji} ${capitalize(item.payload.action)}`;
    return `${line} PR ${toUrlFormat(item)} in ${toUrlFormat(item.repo.name)}`;
  },
  ReleaseEvent: (item) => {
    return `🚀 ${capitalize(item.payload.action)} release ${toUrlFormat(
      item
    )} in ${toUrlFormat(item.repo.name)}`;
  },
};

Toolkit.run(
  async (tools) => {
    tools.log.debug(`Getting activity for ${GH_USERNAME}`);

    let page = 1;
    let events = [];

    while (events.length < MAX_LINES) {
      let data = [];

      try {
        // Get the user's public events
        const resp = await tools.github.activity.listPublicEventsForUser({
          username: GH_USERNAME,
          per_page: 100,
          page: page,
        });

        data = resp.data;
      } catch (err) {
        // Catch any HTTP errors. Especially because the API pagination is
        // limited and throws an error when reaching the end
        tools.log.info(err.message);
        break;
      }

      events = [
        ...events,
        ...data
          // Filter out any boring activity
          .filter((event) => serializers.hasOwnProperty(event.type))
          // We only have five lines to work with
          .slice(0, MAX_LINES)
          // Call the serializer to construct a string
          .map((item) => serializers[item.type](item)),
      ];

      // Remove duplicates
      events = [...new Set(events)];

      // Break out of the loop if we have enough events
      if (events.length >= MAX_LINES) {
        events = events.slice(0, MAX_LINES);
        break;
      }

      page++;
    }

    tools.log.debug(
      `Activity for ${GH_USERNAME}: ${events.length} relevant events found.`
    );

    const readmeContent = fs
      .readFileSync(`./${TARGET_FILE}`, "utf-8")
      .split("\n");

    // Find the index corresponding to <!--START_SECTION:activity--> comment
    let startIdx = readmeContent.findIndex(
      (line) => line.trim() === "<!--START_SECTION:activity-->"
    );

    // Early return in case the <!--START_SECTION:activity--> comment was not found
    if (startIdx === -1) {
      return tools.exit.failure(
        `Couldn't find the <!--START_SECTION:activity--> comment. Exiting!`
      );
    }

    // Find the index corresponding to <!--END_SECTION:activity--> comment
    const endIdx = readmeContent.findIndex(
      (line) => line.trim() === "<!--END_SECTION:activity-->"
    );

    if (!events.length) {
      return tools.exit.success(
        "No PullRequest/Issue/IssueComment/Release events found. Leaving README unchanged with previous activity"
      );
    }

    // Remove all lines between <!--START_SECTION:activity--> and <!--END_SECTION:activity--> comment
    if (endIdx !== -1) {
      readmeContent.splice(startIdx + 1, endIdx - startIdx);
    }

    if (events.length < MAX_LINES) {
      tools.log.info(
        `Found ${events.length} activities. Which is less than ${MAX_LINES} specified by MAX_LINES.`
      );
    }

    startIdx++;

    // Append new content
    events.forEach((line, idx) =>
      readmeContent.splice(startIdx + idx, 0, `${idx + 1}. ${line}`)
    );

    // Append <!--END_SECTION:activity--> comment
    readmeContent.splice(
      startIdx + events.length,
      0,
      "<!--END_SECTION:activity-->"
    );

    // Update README
    fs.writeFileSync(`./${TARGET_FILE}`, readmeContent.join("\n"));

    // Commit to the remote repository
    try {
      await commitFile();
    } catch (err) {
      return tools.exit.failure(err.message);
    }
    tools.exit.success("Pushed update to repository.");
  },
  {
    event: ["schedule", "workflow_dispatch"],
    secrets: ["GITHUB_TOKEN"],
  }
);
