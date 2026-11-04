import { SessionTable } from '../table/SessionTable';

export default function Casino() {
  return (
    <SessionTable
      mode="casino"
      title="Casino"
      intro="A practice bankroll at a real table. Choose how much help you want from the live coach. Your report card (accuracy, money lost to mistakes, luck vs. skill) is saved as you play."
    />
  );
}
