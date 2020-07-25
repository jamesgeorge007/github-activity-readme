const core = require("@actions/core");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Toolkit } = require("actions-toolkit");

const MAX_LINES = 5;

const capitalize = (str) => str.slice(0, 1).toUpperCase() + str.slice(1);

const urlPrefix = "https://github.com/";

const toUrlFormat = (item) => {
  if (typeof item === "object") {
    return Object.hasOwnProperty.call(item.payload, "issue")
      ? `[#${item.payload.issue.number}](${urlPrefix}/${item.repo.name}/issues/${item.payload.issue.number})`
      : `[#${item.payload.pull_request.number}](${urlPrefix}/${item.repo.name}/pull/${item.payload.pull_request.number})`;
  }
  return `[${item}](${urlPrefix}/${item})`;
};

const exec = (cmd, args = []) =>
  new Promise((resolve, reject) => {
    const app = spawn(cmd, args, { stdio: "inherit" });
    app.on("close", (code) => {
      if (code !== 0) {
        err = new Error(`Invalid status code: ${code}`);
        err.code = code;
        return reject(err);
      }
      return resolve(code);
    });
    app.on("error", reject);
  });

const commitFile = async () => {
  await exec("git", [
    "config",
    "--global",
    "user.email",
    "readme-bot@example.com",
  ]);
  await exec("git", ["config", "--global", "user.name", "readme-bot"]);
  await exec("git", ["add", "README.md"]);
  await exec("git", ["commit", "-m", "update"]);
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
    const GH_USERNAME = core.getInput("USERNAME");

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

    let startIdx = readmeContent.findIndex(
      (content) => content === "<!--START_SECTION:activity-->"
    );
    if (
      readmeContent.includes("<!--START_SECTION:activity-->") &&
      !readmeContent.includes("<!--END_SECTION:activity-->")
    ) {
      startIdx++;
      content.forEach((line, idx) =>
        readmeContent.splice(startIdx + idx, 0, `${idx + 1}. ${line}`)
      );
      readmeContent.splice(
        startIdx + content.length,
        0,
        "<!--END_SECTION:activity-->"
      );
      fs.writeFileSync("./README.md", readmeContent.join("\n"));
      try {
        await commitFile();
      } catch (err) {
        tools.log.debug("Something went wrong");
        return tools.exit.failure(err);
      }
      tools.exit.success("Created initial setup");
    }

    const endIdx = readmeContent.findIndex(
      (content) => content === "<!--END_SECTION:activity-->"
    );
    const oldContent = readmeContent.slice(startIdx + 1, endIdx).join("\n");
    const newContent = content
      .map((line, idx) => `${idx + 1}. ${line}`)
      .join("\n");

    if (oldContent.trim() === newContent.trim())
      tools.exit.success("No changes detected");

    startIdx++;

    let count = 0;
    readmeContent.slice(startIdx, endIdx).forEach((line, idx) => {
      if (line !== "") {
        readmeContent[startIdx + idx] = `${count + 1}. ${content[count]}`;
        count++;
      }
    });

    fs.writeFileSync("./README.md", readmeContent.join("\n"));
    try {
      await commitFile();
    } catch (err) {
      tools.log.debug("Something went wrong");
      return tools.exit.failure(err);
    }
    tools.exit.success("Updated ");
  },
  {
    event: "schedule",
    secrets: ["GITHUB_TOKEN"],
  }
);
