# Prompts that mattered

The plan: this kept me in control of the flow. I was sure of what is happening and why claude is doing things that it does during the process.
"create a plan for tdd implementation of movie module with the requirements specified in SPEC.md. each phase of the plan should get a go signal from me so I can do manual checks when I feel like it is needed."

In the exit plan mode menu, I also added a strict instruction on how to utilize the subagents which automated the write->review cycle. This way I did not forget to run the reviewers and found issues which I decided wether to fix to document for future updates.

# What claude got wrong

- When doing my manual SPECS review, I noticed that most endpoints are secured except for the public endpoint for listing all movies which is prone for accidental infinite loops.
- I also saw that a movie can also be duplicated (same title, description, and release date).
  Both of these where never brought up from planning or in the findings of the review subagents.

# single-agent-vs-orchestra

I think the orchestra setup sped up the process. The context usage was also kept to minimum due to the extensive use of subagents. If subagents were not used, I would have needed to compact the session and some context might have been lost.
