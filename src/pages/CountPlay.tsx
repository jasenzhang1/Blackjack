import { SessionTable } from '../table/SessionTable';

export default function CountPlay() {
  return (
    <SessionTable
      mode="countplay"
      title="Count & play"
      intro="Sit at a table with simulated players, keep the count, and play your own hand. You are graded on count checks and on basic strategy. Turn on index deviations (Feature 3b) and you are also graded on changing your play when the shoe is rich or poor."
    />
  );
}
