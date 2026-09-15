import { tool, type PluginModule } from "@opencode-ai/plugin"
import { BackgroundManager } from "../../../packages/omo-opencode/src/features/background-agent/manager"
import { executeSyncContinuation } from "../../../packages/omo-opencode/src/tools/delegate-task/sync-continuation"

// Real harness boundary fixture: no mocked client, event, manager or poller.
export default {
  id: "pr7857-terminal-probe",
  server: async (input) => {
    const manager = new BackgroundManager({ pluginContext: input })
    return {
      event: async ({ event }) => { manager.handleEvent(event) },
      tool: {
        qa_terminal_child: tool({
          description: "Exercise a synchronous continuation whose model does not exist.",
          args: {},
          async execute(_args, context) {
            const child = await input.client.session.create({ body: { parentID: context.sessionID, title: "PR7857 child" } })
            if (!child.data) throw new Error("Child creation failed")
            const sessionID = child.data.id
            const seed = await input.client.session.prompt({
              path: { id: sessionID },
              body: { noReply: true, agent: "build", model: { providerID: "openai", modelID: "pr7857-missing" }, parts: [{ type: "text", text: "PR7857 seed" }] },
            })
            if (seed.error) throw new Error(JSON.stringify(seed.error))
            return executeSyncContinuation({
              task_id: sessionID, description: "PR7857 continuation", prompt: "PR7857 trigger", load_skills: [], run_in_background: false,
            }, context, {
              client: input.client, manager, directory: input.directory, syncPollTimeoutMs: 30000,
            }, { sessionID: context.sessionID, messageID: context.messageID })
          },
        }),
      },
    }
  },
} satisfies PluginModule
