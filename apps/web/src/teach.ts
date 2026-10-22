import { ConsensusMode } from '@isfcr/core'

/** Teaching content for each consensus mode: shown when the rules switch, and in Learn → Lessons. */
export interface Lesson {
  mode: ConsensusMode
  title: string
  short: string
  /** How a block gets made, in three steps (animated one after another). */
  steps: [string, string, string]
  /** What you do on your phone in this mode. */
  you: string
  /** What to look for on the projector. */
  watch: string
  /** How it breaks: the honest weakness. */
  breaks: string
  check: { q: string; choices: string[]; answer: number; why: string }
}

export const LESSONS: Lesson[] = [
  {
    mode: ConsensusMode.GlobalPoW,
    title: 'Proof of Work',
    short: 'Everyone races to find a lucky hash. Faster machines win more often.',
    steps: [
      'Your phone builds a block: the previous block\'s hash, the transactions it picked, and a counter called the nonce.',
      'It hashes the block over and over, changing the nonce each time, looking for a hash below the target.',
      'The first device to find one shares the block. Everyone checks it with a single hash and moves on to the next.',
    ],
    you: 'Tap Start mining and keep the screen on.',
    watch: 'The "top miner\'s share" tile. With one difficulty for everyone, the fastest laptop takes most blocks.',
    breaks: 'Whoever controls most of the hashing power can rewrite recent history. Fairness depends on hardware.',
    check: {
      q: 'Why can everyone check a new block so quickly when finding it took so long?',
      choices: ['They trust the miner', 'Checking takes one hash; finding took millions', 'The server checks it', 'Blocks are small'],
      answer: 1,
      why: 'Finding a hash below the target needs millions of guesses, but verifying it is a single hash. That asymmetry is what makes Proof of Work useful.',
    },
  },
  {
    mode: ConsensusMode.DynamicPoW,
    title: 'Dynamic Proof of Work',
    short: 'Still hashing, but each device gets a target scaled to its speed, so odds are roughly equal.',
    steps: [
      'While you mine, your phone also reports "shares": easier hashes that prove how fast it is.',
      'The host sets your personal target from that speed, so a phone and a gaming laptop expect the same number of wins.',
      'The host signs your target into a ticket inside the block, so other nodes can check it.',
    ],
    you: 'Tap Start mining. Your target adjusts on its own.',
    watch: 'The "top miner\'s share" tile flattening compared with plain Proof of Work.',
    breaks: 'Speed is self-reported, so you can sandbag early and spike later. And one machine can split itself into many addresses, each with an easy target.',
    check: {
      q: 'How does the host know how fast your phone is?',
      choices: ['It asks your phone\'s model', 'From the shares your phone reports', 'It guesses', 'From your balance'],
      answer: 1,
      why: 'Shares are hashes that meet an easier target. Counting them over time estimates your hashrate. Because you report them, you can also lie about them.',
    },
  },
  {
    mode: ConsensusMode.PoS,
    title: 'Proof of Stake',
    short: 'No hashing. The next block\'s maker is drawn by lottery, weighted by the coins people have staked.',
    steps: [
      'You lock some coins as stake. More stake means a bigger share of the lottery.',
      'For each block, a draw seeded by the previous block\'s hash picks a staker. Anyone can recompute who it should be.',
      'The picked staker signs the block, and other stakers sign to vouch for it. If they miss their turn, the next draw takes over.',
    ],
    you: 'Stake some coins. Your phone signs a block automatically when it\'s picked.',
    watch: 'The stake lottery list, and the warning when someone gets slashed for signing two blocks.',
    breaks: 'Whoever holds most of the stake decides. And without slashing, signing every competing block would cost nothing.',
    check: {
      q: 'What stops a staker from signing two different blocks for the same slot?',
      choices: ['Nothing', 'Their phone refuses', 'Anyone can prove it and half their stake is burned', 'The teacher watches'],
      answer: 2,
      why: 'Both blocks carry the staker\'s signature, so anyone can submit them as evidence. The chain then burns half their stake. Cheating has a price.',
    },
  },
  {
    mode: ConsensusMode.VRFLottery,
    title: 'VRF Lottery',
    short: 'Every address gets exactly one ticket per block. The lowest ticket wins.',
    steps: [
      'Your key signs the previous block\'s hash. That signature is your ticket, and only your key can make it.',
      'The ticket\'s hash is your number. Nobody can re-roll it, and anyone can check it.',
      'The lowest number wins the block. No hashing and no stake: every address has equal odds.',
    ],
    you: 'Nothing. Your phone enters a ticket every block.',
    watch: 'The ranked list of tickets on the projector.',
    breaks: 'One address, one ticket. Make ten addresses and you get ten tickets. Fair lotteries need real identity.',
    check: {
      q: 'Why can\'t you keep drawing tickets until you get a low number?',
      choices: ['It costs coins', 'Your key gives the same signature for the same block every time', 'The server blocks you', 'You can'],
      answer: 1,
      why: 'Ed25519 signatures are deterministic: same key, same message, same signature. So your ticket for a block is fixed the moment the previous block exists.',
    },
  },
  {
    mode: ConsensusMode.PoK,
    title: 'Proof of Knowledge',
    short: 'A question goes out. The fastest correct answer makes the next block.',
    steps: [
      'The host publishes a question with a hash of the right answer plus a secret, so it can\'t change the answer later.',
      'You lock in an answer as a hash too, so nobody can copy it while answers are open.',
      'When answers close, everyone reveals. The earliest correct answer wins, and anyone can check the host\'s hash.',
    ],
    you: 'Answer the question before the timer runs out.',
    watch: 'The question and how many people got it right.',
    breaks: 'Answers can leak or be shared, and you must trust the host to pick fair questions.',
    check: {
      q: 'Why does the host publish a hash of the answer before anyone answers?',
      choices: ['To save space', 'So it can\'t change the answer afterwards', 'To make it harder', 'It doesn\'t'],
      answer: 1,
      why: 'A commitment locks the host in. After answers close it reveals the secret, and anyone can hash it to confirm the answer was fixed all along.',
    },
  },
  {
    mode: ConsensusMode.QtV,
    title: 'Quiz-to-Vote',
    short: 'Answer correctly to earn a vote, then vote for who makes the block.',
    steps: [
      'Anyone can put themselves forward as a candidate to make the next block.',
      'A quiz question goes out. A correct answer earns you one vote.',
      'Votes from correct answers are counted, and the candidate with the most makes the block.',
    ],
    you: 'Answer, then pick a candidate. Or put yourself forward.',
    watch: 'The vote tally once voting closes.',
    breaks: 'Answer sharing and vote buying. It separates proposing a block from agreeing on it, like real voting-based chains.',
    check: {
      q: 'What does Quiz-to-Vote separate that Proof of Work does in one step?',
      choices: ['Proposing a block and agreeing on it', 'Fees and rewards', 'Keys and addresses', 'Nothing'],
      answer: 0,
      why: 'In Proof of Work, whoever finds the hash both proposes and effectively finalizes the block. Here candidates propose and voters finalize, which is how voting-based (BFT) chains work.',
    },
  },
  {
    mode: ConsensusMode.PoP,
    title: 'Proof of Presence',
    short: 'Only people in the room can see the code on the projector. One of them is picked.',
    steps: [
      'The projector shows a code and QR that change every 10 seconds, signed by the host.',
      'You check in by scanning it or typing it in.',
      'Among everyone who checked in with a current code, one is picked by a verifiable draw.',
    ],
    you: 'Scan the QR with your camera or type the code.',
    watch: 'The check-in count rising on the projector.',
    breaks: 'Anyone in the room can relay the code to a friend outside. Being present is the identity, and it can be faked.',
    check: {
      q: 'What is the identity check in Proof of Presence?',
      choices: ['Your balance', 'Your hashrate', 'Seeing the code in the room', 'Your name'],
      answer: 2,
      why: 'The code is only shown on the projector and changes every 10 seconds, so knowing it means you were looking at the screen just now. Relaying it breaks that.',
    },
  },
  {
    mode: ConsensusMode.PoV,
    title: 'Proof of Peer Vouching',
    short: 'People vouch for who should make the block. Vouches count more from people who trade with many classmates.',
    steps: [
      'Trust comes from the chain: how many different people you have exchanged coins with, up to 5.',
      'Candidates put themselves forward, and everyone vouches for one.',
      'Vouches are weighted by trust, and the most-trusted candidate makes the block.',
    ],
    you: 'Vouch for someone. Send coins to classmates to raise your trust.',
    watch: 'The trust list on the projector.',
    breaks: 'A ring of fake accounts paying each other looks like a group of well-connected people.',
    check: {
      q: 'How could someone fake a lot of trust?',
      choices: ['Mine faster', 'Make fake accounts that pay each other', 'Stake more', 'Answer quizzes'],
      answer: 1,
      why: 'Trust counts distinct trading partners, and creating accounts is free. A ring of fake accounts trading in a circle inflates everyone in it.',
    },
  },
  {
    mode: ConsensusMode.PoET,
    title: 'Simulated Proof of Elapsed Time',
    short: 'The host hands everyone a random wait. The shortest wait wins.',
    steps: [
      'Your phone asks the host\'s timer for a wait time. Everyone gets a random one.',
      'The waits run down at the same time.',
      'Whoever\'s timer runs out first makes the block.',
    ],
    you: 'Nothing. Your phone requests a timer automatically.',
    watch: 'The shortest timer counting down.',
    breaks: 'Everything rests on the timer being honest. Real systems use trusted hardware for it, and that hardware can be broken.',
    check: {
      q: 'In PoET, who do you have to trust?',
      choices: ['The fastest miner', 'The timer', 'The richest student', 'Nobody'],
      answer: 1,
      why: 'The winner is whoever drew the shortest wait, so a rigged timer decides everything. Real PoET relies on trusted hardware (like Intel SGX) for this.',
    },
  },
]

export const lessonFor = (mode: number) => LESSONS.find((l) => l.mode === mode)

export const GLOSSARY: [string, string][] = [
  ['Block', 'A bundle of transactions plus a header that links to the previous block by its hash.'],
  ['Hash', 'A fingerprint of data. Change one byte and the hash changes completely. Here it\'s SHA-256: 64 hex characters.'],
  ['Nonce', 'A counter a miner changes to get a different hash for the same block.'],
  ['Target', 'The number a Proof of Work hash must be at or below. Lower target, harder block.'],
  ['Difficulty', 'How many hashes a block takes on average. Rises when blocks come too fast.'],
  ['Merkle root', 'One hash that summarises every transaction in a block. Change any transaction and it changes.'],
  ['Mempool', 'Transactions waiting to be put into a block. Miners pick the highest fees first.'],
  ['Fee', 'What you pay the block maker to include your transaction. Higher fees go first.'],
  ['Nonce (account)', 'Each transaction from an address has a sequence number, so it can\'t be replayed.'],
  ['Private key', 'The secret that proves an address is yours. It never leaves your phone.'],
  ['Signature', 'Proof that the holder of a private key approved exactly these bytes.'],
  ['Address', 'The first 20 bytes of the hash of your public key, written after "isfcr1".'],
  ['Stake', 'Coins you lock to take part in Proof of Stake. They can be burned if you cheat.'],
  ['Slashing', 'Burning a cheater\'s stake, triggered by evidence anyone can submit.'],
  ['Fork', 'Two versions of the chain that share history and then split.'],
  ['Consensus', 'The rule a network uses to agree on the next block.'],
  ['Sybil attack', 'Pretending to be many people by making many identities.'],
  ['Commitment', 'Publishing a hash of something now, so you can\'t change it when you reveal it later.'],
  ['Faucet', 'The account that gives every newcomer free coins to start.'],
  ['Halving', 'The block reward halves every 100 blocks here, so coins get scarcer.'],
]
