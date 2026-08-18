# Launch copy — ready to post

Level 4 asks for a public product profile. The account itself has to be created by a human, so
this file holds the copy, already written. Nothing here needs editing before it goes out.

## X / Twitter — profile

**Name:** Umbra
**Handle suggestion:** `@umbra_polls` (fall back to `@umbrapolls` / `@umbra_vote`)

**Bio (154 chars):**

> Anonymous, verifiable polls on @MidnightNtwrk. The tally is public, the voter is not, and one
> key votes once — enforced by zero-knowledge proofs, not by trusting us.

**Link:** https://itsgriznft.github.io/umbra-midnight/
**Pinned post:** the launch thread below.

## Launch thread

**1/**
> On-chain governance has a problem nobody says out loud: every vote you cast is public, forever,
> attached to your address.
>
> So people copy the whales, dissent quietly, or don't vote at all.
>
> Umbra fixes that without giving up verifiability. 🌓

**2/**
> Today you pick two of three:
>
> · on-chain token vote — verifiable, but every ballot is public
> · Snapshot — verifiable, but the signer is visible
> · a web2 poll — private-ish, but you trust whoever counts
>
> Umbra gets all three at once.

**3/**
> How: your secret key never leaves your device. The circuit derives a nullifier from it, checks
> it hasn't been used for this poll, records it, and bumps the chosen option's public counter.
>
> The tally moves. Nothing links it to you.

**4/**
> Private polls go further. The organiser publishes only the *root* of a Merkle tree of members.
>
> You prove membership with a path that stays a private witness — so a ballot proves the voter
> was eligible without revealing which member cast it.

**5/**
> Live on Midnight Preview, and you can check it yourself rather than take our word:
>
> factory  7733833db4dc875b59ac36a29f25e73c35060a1135a9fa7b6b984a852fd12b7f
>
> The demo queries the public indexer in your browser and shows what comes back.

**6/**
> Try it — no wallet needed:
> https://itsgriznft.github.io/umbra-midnight/
>
> Code, contracts, 43 tests, CI:
> https://github.com/itsgriznft/umbra-midnight
>
> Built for New Moon to Full 🌙

## Notes

- Keep the contract address in the thread. It is what makes the claim checkable, and it is the
  detail most launch posts leave out.
- The bio deliberately says "not by trusting us" — the no-trusted-tallier property is the
  differentiator, so it belongs where people actually read.
