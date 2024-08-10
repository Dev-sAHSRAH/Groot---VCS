#!/usr/bin/env node

import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { diffLines } from "diff";
import chalk from "chalk";
import { Command } from "commander";

const program = new Command();

class Groot {
  constructor(repoPath = ".") {
    this.repoPath = path.join(repoPath, ".groot");
    this.objectsPath = path.join(this.repoPath, "objects"); // .groot/objects
    this.headPath = path.join(this.repoPath, "HEAD");
    this.indexPath = path.join(this.repoPath, "index"); // .groot/index  (for staging area)

    this.init();
  }

  async init() {
    await fs.mkdir(this.objectsPath, { recursive: true });
    try {
      await fs.writeFile(this.headPath, "", { flag: "wx" }); //wx: open for writing. fails if file exists

      await fs.writeFile(this.indexPath, JSON.stringify([]), { flag: "wx" });
    } catch (error) {
      console.log("Already initialised the .groot folder");
    }
  }

  hashObject(content) {
    return crypto.createHash("sha1").update(content, "utf-8").digest("hex");
  }

  async add(fileToBeAdded) {
    const fileData = await fs.readFile(fileToBeAdded, { encoding: "utf-8" });
    const fileHash = this.hashObject(fileData);

    const newFileHashedObjectPath = path.join(this.objectsPath, fileHash);
    await fs.writeFile(newFileHashedObjectPath, fileData);

    // Add the file to staging area

    await this.updateStagingArea(fileToBeAdded, fileHash);

    console.log(`Added ${fileToBeAdded}`);
  }

  async updateStagingArea(filePath, fileHash) {
    const index = JSON.parse(
      await fs.readFile(this.indexPath, { encoding: "utf-8" })
    );

    index.push({ path: filePath, hash: fileHash }); // add file to index
    await fs.writeFile(this.indexPath, JSON.stringify(index));
  }

  async getCurrentHead() {
    try {
      return await fs.readFile(this.headPath, { encoding: "utf-8" });
    } catch (error) {
      return null;
    }
  }

  async commit(message) {
    const index = JSON.parse(
      await fs.readFile(this.indexPath, { encoding: "utf-8" })
    );

    const parentCommit = await this.getCurrentHead();

    const commitData = {
      timeStamp: new Date().toISOString(),
      message,
      files: index,
      parent: parentCommit,
    };

    const commitHash = this.hashObject(JSON.stringify(commitData));
    const commitPath = path.join(this.objectsPath, commitHash);
    await fs.writeFile(commitPath, JSON.stringify(commitData));
    // now HEAD should point to the new path
    await fs.writeFile(this.headPath, commitHash);
    // clear the staging area
    await fs.writeFile(this.indexPath, JSON.stringify([]));

    console.log(`Commit successfully created: ${commitHash}`);
  }

  async log() {
    let currentCommitHash = await this.getCurrentHead();

    while (currentCommitHash) {
      const commitData = JSON.parse(
        await fs.readFile(path.join(this.objectsPath, currentCommitHash), {
          encoding: "utf-8",
        })
      );

      console.log(
        `Commit: ${currentCommitHash}\nDate: ${commitData.timeStamp}\n\n${commitData.message}\n\n`
      );
      console.log(`_________________________`);

      currentCommitHash = commitData.parent;
    }
  }

  async getParentFileContent(parentCommitData, filePath) {
    const parentFile = parentCommitData.files.find(
      (file) => file.path === filePath
    );

    if (parentFile) {
      // get the file content from parent commit
      // and return the content
      return await this.getFileContent(parentFile.hash);
    }
  }

  async getCommitData(commitHash) {
    const commitPath = path.join(this.objectsPath, commitHash);
    try {
      return await fs.readFile(commitPath, { encoding: "utf-8" });
    } catch (error) {
      console.log("Failed to read commit data", error);
      return null;
    }
  }

  async getFileContent(fileHash) {
    const objectPath = path.join(this.objectsPath, fileHash);
    try {
      return await fs.readFile(objectPath, { encoding: "utf-8" });
    } catch (error) {
      console.log("Unable to read file");
      return null;
    }
  }

  async showCommitDiff(commitHash) {
    const commitData = JSON.parse(await this.getCommitData(commitHash));

    if (!commitData) {
      console.log("Commit Not found");
      return;
    }
    console.log("Changes in the last commit are: ");

    for (const file of commitData.files) {
      console.log(`File: ${file.path}`);
      const fileContent = await this.getFileContent(file.hash);
      console.log(fileContent);

      if (commitData.parent) {
        // get parent commit data
        const parentCommitData = JSON.parse(
          await this.getCommitData(commitData.parent)
        );

        const parentFileContent = await this.getParentFileContent(
          parentCommitData,
          file.path
        );

        if (parentFileContent !== undefined) {
          console.log("\nDiff:");

          const diff = diffLines(parentFileContent, fileContent);

          diff.forEach((part) => {
            if (part.added) {
              process.stdout.write(chalk.green("++ " + part.value));
            } else if (part.removed) {
              process.stdout.write(chalk.red("-- " + part.value));
            } else {
              process.stdout.write(chalk.grey(part.value));
            }
          });

          console.log();
        } else {
          console.log("New file in this commit");
        }
      } else {
        console.log("First Commit (No parent commit)");
      }
    }
  }

  async status() {
    const index = JSON.parse(
      await fs.readFile(this.indexPath, { encoding: "utf-8" })
    );
    const headCommitHash = await this.getCurrentHead();
    let trackedFiles = [];
    if (headCommitHash) {
      const headCommitData = JSON.parse(
        await this.getCommitData(headCommitHash)
      );
      trackedFiles = headCommitData.files;
    }

    const workingDirFiles = await fs.readdir(".", { withFileTypes: true });
    const workingFiles = workingDirFiles
      .filter((file) => file.isFile() && file.name !== ".groot")
      .map((file) => file.name);

    const stagedFiles = index.map((file) => file.path);
    const modifiedFiles = [];
    const untrackedFiles = [];
    const modifiedStagedFiles = [];

    for (const file of workingFiles) {
      const fileData = await fs.readFile(file, { encoding: "utf-8" });
      const fileHash = this.hashObject(fileData);

      const stagedFile = index.find((f) => f.path === file);
      const trackedFile = trackedFiles.find((f) => f.path === file);

      if (stagedFile && stagedFile.hash !== fileHash) {
        // File is modified after being staged
        modifiedStagedFiles.push(file);
      } else if (!stagedFile && trackedFile && trackedFile.hash !== fileHash) {
        // File is modified but not staged
        modifiedFiles.push(file);
      } else if (!stagedFile && !trackedFile) {
        // File is untracked
        untrackedFiles.push(file);
      }
    }

    console.log(chalk.bold("Changes to be committed:"));
    stagedFiles.forEach((file) => {
      console.log(chalk.green(`  ${file}`));
    });

    console.log(chalk.bold("\nChanges staged but modified:"));
    modifiedStagedFiles.forEach((file) => {
      console.log(chalk.magenta(`  ${file}`));
    });

    console.log(chalk.bold("\nUntracked files:"));
    untrackedFiles.forEach((file) => {
      console.log(chalk.yellow(`  ${file}`));
    });
  }
}

program.command("init").action(async () => {
  const groot = new Groot();
});

program.command("add <file>").action(async (file) => {
  const groot = new Groot();
  await groot.add(file);
});

program.command("commit <message>").action(async (message) => {
  const groot = new Groot();
  await groot.commit(message);
});

program.command("log").action(async () => {
  const groot = new Groot();
  await groot.log();
});

program.command("diff <commitHash>").action(async (commitHash) => {
  const groot = new Groot();
  await groot.showCommitDiff(commitHash);
});

program.command("status").action(async () => {
  const groot = new Groot();
  await groot.status();
});

program.parse(process.argv);
