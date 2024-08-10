import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

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
    console.log(fileHash);

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
}

const groot = new Groot();
groot.add("sample.txt");
