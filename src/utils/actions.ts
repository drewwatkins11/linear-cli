import { open } from "@opensrc/deno-open"
import { Select } from "@cliffy/prompt"
import { branchExists } from "./git.ts"
import {
  fetchIssueDetails,
  getIssueIdentifier,
  getStartedState,
  getTeamKey,
  updateIssueState,
} from "./linear.ts"
import { getOption } from "../config.ts"
import { encodeBase64 } from "@std/encoding/base64"

export async function openIssuePage(
  providedId?: string,
  options: { app?: boolean; web?: boolean } = {},
) {
  const issueId = await getIssueIdentifier(providedId)
  if (!issueId) {
    console.error(
      "The current branch does not contain a valid linear issue id.",
    )
    Deno.exit(1)
  }

  const workspace = getOption("workspace")
  if (!workspace) {
    console.error(
      "workspace is not set via command line, configuration file, or environment.",
    )
    Deno.exit(1)
  }

  const url = `https://linear.app/${workspace}/issue/${issueId}`
  const destination = options.app ? "Linear.app" : "web browser"
  console.log(`Opening ${url} in ${destination}`)
  await open(url, options.app ? { app: { name: "Linear" } } : undefined)
}

export async function openProjectPage(
  projectId: string,
  options: { app?: boolean; web?: boolean } = {},
) {
  const workspace = getOption("workspace")
  if (!workspace) {
    console.error(
      "workspace is not set via command line, configuration file, or environment.",
    )
    Deno.exit(1)
  }

  const url = `https://linear.app/${workspace}/project/${projectId}`
  const destination = options.app ? "Linear.app" : "web browser"
  console.log(`Opening ${url} in ${destination}`)
  await open(url, options.app ? { app: { name: "Linear" } } : undefined)
}

export async function openTeamAssigneeView(options: { app?: boolean } = {}) {
  const teamId = getTeamKey()
  if (!teamId) {
    console.error(
      "Could not determine team id from configuration or directory name.",
    )
    Deno.exit(1)
  }

  const workspace = getOption("workspace")
  if (!workspace) {
    console.error(
      "workspace is not set via command line, configuration file, or environment.",
    )
    Deno.exit(1)
  }

  const filterObj = {
    "and": [{ "assignee": { "or": [{ "isMe": { "eq": true } }] } }],
  }
  const filter = encodeBase64(JSON.stringify(filterObj)).replace(/=/g, "")
    const url =
    `https://linear.app/${workspace}/team/${teamId}/active?filter=${filter}`
  await open(url, options.app ? { app: { name: "Linear" } } : undefined)
}

async function checkoutBranch(branchName: string, preferGraphite: boolean): Promise<boolean> {
  if (preferGraphite) {
    const process = new Deno.Command("gt", {
      args: ["checkout", branchName],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    const status = await process.spawn().status
    if (status.success) {
      console.log(`✓ Switched to '${branchName}' using Graphite`)
      return true
    }
    return false
  } else {
    const process = new Deno.Command("git", {
      args: ["checkout", branchName],
    })
    const { success } = await process.output()
    if (success) {
      console.log(`✓ Switched to '${branchName}'`)
      return true
    }
    return false
  }
}

async function createBranch(
  branchName: string,
  preferGraphite: boolean,
  gitSourceRef?: string
): Promise<boolean> {
  if (preferGraphite) {
    const process = new Deno.Command("gt", {
      args: ["create", branchName],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    const status = await process.spawn().status
    if (status.success) {
      console.log(
        `✓ Created and switched to branch '${branchName}' using Graphite`
      )
      return true
    }
    return false
  } else {
    const process = new Deno.Command("git", {
      args: ["checkout", "-b", branchName, gitSourceRef || "HEAD"],
    })
    const { success } = await process.output()
    if (success) {
      console.log(`✓ Created and switched to branch '${branchName}'`)
      return true
    }
    return false
  }
}

async function findAvailableBranchName(baseName: string): Promise<string> {
  let suffix = 1
  let newBranch = `${baseName}-${suffix}`
  while (await branchExists(newBranch)) {
    suffix++
    newBranch = `${baseName}-${suffix}`
  }
  return newBranch
}

export async function startWorkOnIssue(
  issueId: string,
  teamId: string,
  gitSourceRef?: string,
) {
  const { branchName } = await fetchIssueDetails(issueId, true)
  const preferGraphite = getOption("prefer_graphite") === "true"

  // Handle branch creation/switching logic
  let branchOperationSucceeded = false
  
  if (await branchExists(branchName)) {
    const answer = await Select.prompt({
      message:
        `Branch ${branchName} already exists. What would you like to do?`,
      options: [
        { name: "Switch to existing branch", value: "switch" },
        { name: "Create new branch with suffix", value: "create" },
      ],
    })

    if (answer === "switch") {
      branchOperationSucceeded = await checkoutBranch(branchName, preferGraphite)
    } else {
      const newBranch = await findAvailableBranchName(branchName)
      branchOperationSucceeded = await createBranch(newBranch, preferGraphite, gitSourceRef)
    }
  } else {
    branchOperationSucceeded = await createBranch(branchName, preferGraphite, gitSourceRef)
  }

  // Only update issue state if branch operations succeeded
  if (branchOperationSucceeded) {
    try {
      const state = await getStartedState(teamId)
      if (!issueId) {
        console.error("No issue ID resolved")
        Deno.exit(1)
      }
      await updateIssueState(issueId, state.id)
      console.log(`✓ Issue state updated to '${state.name}'`)
    } catch (error) {
      console.error("Failed to update issue state:", error)
    }
  } else {
    console.log("Branch operation failed - issue state not updated")
  }
}
