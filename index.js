const core = require("@actions/core");
const fs = require("fs");
const { spawn } = require("child_process");
const { Toolkit } = require("actions-toolkit");

// Get config
const GH_USERNAME = core.getInput("GH_USERNAME");
const COMMIT_NAME = core.getInput("COMMIT_NAME");
const COMMIT_EMAIL = core.getInput("COMMIT_EMAIL");
const COMMIT_MSG = core.getInput("COMMIT_MSG");
const MAX_LINES = core.getInput("MAX_LINES");
const TARGET_FILE = core.getInput("TARGET_FILE");
const EMPTY_COMMIT_MSG = core.getInput("EMPTY_COMMIT_MSG");

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
    const release = item.payload.release.name || item.payload.release.tag_name;
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
    const app = spawn(cmd, args);

    let stdout = "";
    if (app.stdout) {
      app.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }

    let stderr = "";
    if (app.stderr) {
      app.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    app.on("close", (code) => {
      if (code !== 0 && !stdout.includes("nothing to commit")) {
        return reject(new Error(`Exit code: ${code}\n${stdout}`));
      }
      return resolve(stdout);
    });

    app.on("error", () => reject(new Error(`Exit code: ${code}\n${stderr}`)));
  });

/**
 * Make a commit
 *
 * @returns {Promise<void>}
 */

const commitFile = async (emptyCommit = false) => {
  await exec("git", ["config", "--global", "user.email", COMMIT_EMAIL]);
  await exec("git", ["config", "--global", "user.name", COMMIT_NAME]);
  if (emptyCommit) {
    await exec("git", ["commit", "--allow-empty", "-m", EMPTY_COMMIT_MSG]);
  } else {
    await exec("git", ["add", TARGET_FILE]);
    await exec("git", ["commit", "-m", COMMIT_MSG]);
  }
  await exec("git", ["push"]);
};

/**
 * Creates an empty commit if no activity has been detected for over 50 days
 * @returns {Promise<void>}
 * */
const createEmptyCommit = async () => {
  const { lastCommitDate } = await exec("git", [
    "--no-pager",
    "log",
    "-1",
    "--format=%ct",
  ]);

  const commitDate = new Date(parseInt(lastCommitDate, 10) * 1000);
  const diffInDays = Math.round(
    (new Date() - commitDate) / (1000 * 60 * 60 * 24),
  );

  core.debug(`Difference in days: ${diffInDays}`);

  if (diffInDays > 50) {
    core.info("Create empty commit to keep workflow active");
    await commitFile(true);
    return "Empty commit pushed";
  }

  return "No PullRequest/Issue/IssueComment/Release events found. Leaving README unchanged with previous activity";
};

const serializers = {
  IssueCommentEvent: (item) => {
    return `🗣 Commented on ${toUrlFormat(item)} in ${toUrlFormat(
      item.repo.name,
    )}`;
  },
  IssuesEvent: (item) => {
    let emoji = "";

    switch (item.payload.action) {
      case "opened":
        emoji = "❗";
        break;
      case "reopened":
        emoji = "🔓";
        break;
      case "closed":
        emoji = "🔒";
        break;
    }

    return `${emoji} ${capitalize(item.payload.action)} issue ${toUrlFormat(
      item,
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
      item,
    )} in ${toUrlFormat(item.repo.name)}`;
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
      `Activity for ${GH_USERNAME}, ${events.data.length} events found.`,
    );

    const content = events.data
      // Filter out any boring activity
      .filter((event) => serializers.hasOwnProperty(event.type))
      // We only have five lines to work with
      .slice(0, MAX_LINES)
      // Call the serializer to construct a string
      .map((item) => serializers[item.type](item));

    const readmeContent = fs
      .readFileSync(`./${TARGET_FILE}`, "utf-8")
      .split("\n");

    // Find the index corresponding to <!--START_SECTION:activity--> comment
    let startIdx = readmeContent.findIndex(
      (content) => content.trim() === "<!--START_SECTION:activity-->",
    );

    // Early return in case the <!--START_SECTION:activity--> comment was not found
    if (startIdx === -1) {
      return tools.exit.failure(
        `Couldn't find the <!--START_SECTION:activity--> comment. Exiting!`,
      );
    }

    // Find the index corresponding to <!--END_SECTION:activity--> comment
    const endIdx = readmeContent.findIndex(
      (content) => content.trim() === "<!--END_SECTION:activity-->",
    );

    if (content.length == 0) {
      tools.log.info("Found no activity.");

      try {
        const message = await createEmptyCommit();
        tools.exit.success(message);
      } catch (err) {
        return tools.exit.failure(err.message);
      }
    }

    if (content.length < 5) {
      tools.log.info("Found less than 5 activities");
    }

    if (startIdx !== -1 && endIdx === -1) {
      // Add one since the content needs to be inserted just after the initial comment
      startIdx++;
      content.forEach((line, idx) =>
        readmeContent.splice(startIdx + idx, 0, `${idx + 1}. ${line}`),
      );

      // Append <!--END_SECTION:activity--> comment
      readmeContent.splice(
        startIdx + content.length,
        0,
        "<!--END_SECTION:activity-->",
      );

      // Update README
      fs.writeFileSync(`./${TARGET_FILE}`, readmeContent.join("\n"));

      // Commit to the remote repository
      try {
        await commitFile();
      } catch (err) {
        return tools.exit.failure(err.message);
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
      tools.log.success(`Wrote to ${TARGET_FILE}`);
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
      tools.log.success(`Updated ${TARGET_FILE} with the recent activity`);
    }

    // Update README
    fs.writeFileSync(`./${TARGET_FILE}`, readmeContent.join("\n"));

    // Commit to the remote repository
    try {
      await commitFile();
    } catch (err) {
      return tools.exit.failure(err.message);
    }
    tools.exit.success("Pushed to remote repository");
  },
  {
    event: ["schedule", "workflow_dispatch"],
    secrets: ["GITHUB_TOKEN"],
  },
);
