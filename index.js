const core = require("@actions/core");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Toolkit } = require("actions-toolkit");

// Get config
const GH_USERNAME = core.getInput("GH_USERNAME");
const COMMIT_MSG = core.getInput("COMMIT_MSG");
const MAX_LINES = core.getInput("MAX_LINES");
/**
 * Returns the sentence case representation
 * @param {String} str - the string
 *
 * @returns {String}
 */

const capitalize = (str) => str.slice(0, 1).toUpperCase() + str.slice(1);

const urlPrefix = "https://github.com";

/**
 * Returns a URL in markdown format for PR's and issues
 * @param {Object | String} item - holds information concerning the issue/PR
 *
 * @returns {String}
 */

const toUrlFormat = (item) => {
  if (typeof item === "object") {
    return Object.hasOwnProperty.call(item.payload, "issue")
      ? `[#${item.payload.issue.number}](${urlPrefix}/${item.repo.name}/issues/${item.payload.issue.number})`
      : `[#${item.payload.pull_request.number}](${urlPrefix}/${item.repo.name}/pull/${item.payload.pull_request.number})`;
  }
  return `[${item}](${urlPrefix}/${item})`;
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
  await exec("git", [
    "config",
    "--global",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
  await exec("git", ["config", "--global", "user.name", "readme-bot"]);
  await exec("git", ["add", "README.md"]);
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
    return `❗️ ${capitalize(item.payload.action)} issue ${toUrlFormat(
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
};

Toolkit.run(
  async (tools) => {
    // Get the user's public events
    tools.log.debug(`Getting activity for ${GH_USERNAME}`);
    const events = await tools.github.activity.listPublicEventsForUser({
      username: GH_USERNAME,
      per_page: 100,
    });
    tools.log.debug(
      `Activity for ${GH_USERNAME}, ${events.data.length} events found.`
    );

    const content = events.data
      // Filter out any boring activity
      .filter((event) => serializers.hasOwnProperty(event.type))
      // We only have five lines to work with
      .slice(0, MAX_LINES)
      // Call the serializer to construct a string
      .map((item) => serializers[item.type](item));

    const readmeContent = fs.readFileSync("./README.md", "utf-8").split("\n");

    // Find the index corresponding to <!--START_SECTION:activity--> comment
    let startIdx = readmeContent.findIndex(
      (content) => content.trim() === "<!--START_SECTION:activity-->"
    );

    // Early return in case the <!--START_SECTION:activity--> comment was not found
    if (startIdx === -1) {
      return tools.exit.failure(
        `Couldn't find the <!--START_SECTION:activity--> comment. Exiting!`
      );
    }

    // Find the index corresponding to <!--END_SECTION:activity--> comment
    const endIdx = readmeContent.findIndex(
      (content) => content.trim() === "<!--END_SECTION:activity-->"
    );

    if (!content.length) {
      tools.exit.failure("No PullRequest/Issue/IssueComment events found");
    }

    if (content.length < 5) {
      tools.log.info("Found less than 5 activities");
    }

    if (startIdx !== -1 && endIdx === -1) {
      // Add one since the content needs to be inserted just after the initial comment
      startIdx++;
      content.forEach((line, idx) =>
        readmeContent.splice(startIdx + idx, 0, `${idx + 1}. ${line}`)
      );

      // Append <!--END_SECTION:activity--> comment
      readmeContent.splice(
        startIdx + content.length,
        0,
        "<!--END_SECTION:activity-->"
      );

      // Update README
      fs.writeFileSync("./README.md", readmeContent.join("\n"));

      // Commit to the remote repository
      try {
        await commitFile();
      } catch (err) {
        tools.log.debug("Something went wrong");
        return tools.exit.failure(err);
      }
      tools.exit.success("Wrote to README");
    }

    const oldContent = readmeContent.slice(startIdx + 1, endIdx).join("\n");
    const newContent = content
      .map((line, idx) => `${idx + 1}. ${line}`)
      .join("\n");

    if (oldContent.trim() === newContent.trim())
      tools.exit.success("No changes detected");

    startIdx++;

    // Recent GitHub Activity content between the comments
    const readmeActivitySection = readmeContent.slice(startIdx, endIdx);
    if (!readmeActivitySection.length) {
      content.some((line, idx) => {
        // User doesn't have 5 public events
        if (!line) {
          return true;
        }
        readmeContent.splice(startIdx + idx, 0, `${idx + 1}. ${line}`);
      });
      tools.log.success("Wrote to README");
    } else {
      // It is likely that a newline is inserted after the <!--START_SECTION:activity--> comment (code formatter)
      let count = 0;

      readmeActivitySection.some((line, idx) => {
        // User doesn't have 5 public events
        if (!content[count]) {
          return true;
        }
        if (line !== "") {
          readmeContent[startIdx + idx] = `${count + 1}. ${content[count]}`;
          count++;
        }
      });
      tools.log.success("Updated README with the recent activity");
    }

    // Update README
    fs.writeFileSync("./README.md", readmeContent.join("\n"));

    // Commit to the remote repository
    try {
      await commitFile();
    } catch (err) {
      tools.log.debug("Something went wrong");
      return tools.exit.failure(err);
    }
    tools.exit.success("Pushed to remote repository");
  },
  {
    event: ["schedule", "workflow_dispatch"],
    secrets: ["GITHUB_TOKEN"],
  }
);
