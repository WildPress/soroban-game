# Soroban Game

A small browser game inspired by soroban practice.

The idea is to make a puzzle game that feels a bit like a bubble-popping or chain-building game, but where the number making happens on a soroban-style board. It is still early, but the goal is to explore whether soroban practice can be turned into something more playful without making the soroban interaction purely decorative.

Try it here:

https://wildpress.github.io/soroban-game/

Source code:

https://github.com/WildPress/soroban-game

## How To Play

Use the soroban board to make a number. The bubbles above the board each have a value. When the number on the soroban matches one or more bubbles, those bubbles can be selected as part of a chain.

Right now the prototype is based on addition:

1. Move beads on the soroban to make a number.
2. Match bubbles whose values add up to that number.
3. Build longer chains to score more.
4. Press **Go** to clear a valid chain.

The current prototype uses addition, but the same basic idea could be extended to subtraction, multiplication, and division. Those modes would likely need larger soroban layouts with more columns.

## Why This Exists

This is an experiment in making soroban practice feel more like a puzzle game. The rough direction is somewhere between educational arithmetic practice and chain-based games like bubble poppers or match games.

Possible future ideas:

- More operation modes: subtraction, multiplication, division
- Special bubble shapes or bonuses
- More puzzle/challenge modes
- Better feedback for learners
- Difficulty progression
- More traditional soroban training modes alongside the game mode

Feedback from people who use, teach, or study soroban would be especially useful.

## Parametric Soroban CAD Model

There is also a parametric soroban board made with JSCAD:

https://wildpress.github.io/soroban-game/cad.html

This is not playable like the game. It is more of an adjustable CAD/modeling tool. You can change parameters such as the number of columns, bead shape, and column values to generate different reusable soroban models.

The raw JSCAD model is here:

https://wildpress.github.io/soroban-game/soroban-cad.jscad.js

## Local Development

Install dependencies:

```bash
npm install
```

Start the game locally:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run checks:

```bash
npm run test
```

Run the local JSCAD UI workflow:

```bash
npm run cad
```

The GitHub Pages build publishes both the game and the `cad.html` model page.
