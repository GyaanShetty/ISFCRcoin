/** Multiple-choice question for Proof of Knowledge and Quiz-to-Vote. `answer` is the index of the right choice. */
export interface Question {
  text: string
  choices: string[]
  answer: number
}

/** Default bank, about what the class is doing. The instructor can upload their own. */
export const QUESTIONS: Question[] = [
  { text: 'What does each block store to link it to the block before it?', choices: ['The previous block’s hash', 'The miner’s name', 'A timestamp only', 'The total supply'], answer: 0 },
  { text: 'You change one old transaction. What breaks?', choices: ['Nothing', 'Only that transaction', 'That block’s hash and every block after it', 'Only the newest block'], answer: 2 },
  { text: 'What does a Merkle root summarise?', choices: ['All transactions in a block', 'All wallets', 'The miner’s hashrate', 'The block reward'], answer: 0 },
  { text: 'Why do miners pick high-fee transactions first?', choices: ['It is required', 'They keep the fees', 'They are smaller', 'They are older'], answer: 1 },
  { text: 'In Proof of Work, what makes a hash “win”?', choices: ['It is even', 'It is below the target', 'It has your name in it', 'It was sent first'], answer: 1 },
  { text: 'What does Dynamic PoW scale for each miner?', choices: ['The reward', 'The fee', 'The difficulty target', 'The block size'], answer: 2 },
  { text: 'In Proof of Stake, who is likelier to propose the next block?', choices: ['The fastest phone', 'Whoever has more coins staked', 'Whoever joined first', 'Everyone equally'], answer: 1 },
  { text: 'What happens if a PoS proposer signs two different blocks for one slot?', choices: ['Both are accepted', 'Nothing', 'Half their stake is burned', 'They get double reward'], answer: 2 },
  { text: 'Why can’t you re-roll your VRF lottery ticket?', choices: ['The server saves it', 'Your key always gives the same signature for the same block', 'It costs coins', 'You can'], answer: 1 },
  { text: 'What is the weak spot of “one address, one ticket”?', choices: ['Slow phones', 'High fees', 'People making many addresses', 'Long blocks'], answer: 2 },
  { text: 'What does your signature on a transaction prove?', choices: ['That you hold the private key', 'That you are rich', 'That the block is valid', 'That the fee is paid'], answer: 0 },
  { text: 'Who must you trust in Proof of Presence?', choices: ['Nobody', 'The host showing the code', 'The richest student', 'The fastest miner'], answer: 1 },
  { text: 'How does the block reward change in this class chain?', choices: ['It never changes', 'It halves every 100 blocks', 'It doubles every block', 'It is random'], answer: 1 },
  { text: 'What is a fork?', choices: ['Two chains that share history then split', 'A wallet backup', 'A kind of fee', 'A slow block'], answer: 0 },
  { text: 'Why does changing the consensus rules need everyone to switch at the same block?', choices: ['To save energy', 'Otherwise nodes disagree and the chain splits', 'It is faster', 'It does not'], answer: 1 },
  { text: 'What does the mempool hold?', choices: ['Mined blocks', 'Transactions waiting to be included', 'Private keys', 'The leaderboard'], answer: 1 },
  { text: 'In Quiz-to-Vote, what earns you a vote?', choices: ['Holding coins', 'Answering correctly', 'Mining fast', 'Joining early'], answer: 1 },
  { text: 'In Peer Vouching, where does trust come from?', choices: ['Hashrate', 'Who you have exchanged coins with', 'Your name', 'The block reward'], answer: 1 },
]
