export interface MasterRole {
  name: string;
  category: string;
}

export const ROLES_MASTER_LIST: MasterRole[] = [
  // Software & Web
  { name: "Frontend Engineer", category: "Software & Web" },
  { name: "Backend Engineer", category: "Software & Web" },
  { name: "Full-Stack Engineer", category: "Software & Web" },
  { name: "Mobile Engineer (Android)", category: "Software & Web" },
  { name: "Mobile Engineer (iOS)", category: "Software & Web" },
  { name: "Game Developer", category: "Software & Web" },
  { name: "AR/VR Engineer", category: "Software & Web" },
  { name: "Blockchain Engineer", category: "Software & Web" },

  // Data & AI
  { name: "Data Analyst", category: "Data & AI" },
  { name: "Data Scientist", category: "Data & AI" },
  { name: "Data Engineer", category: "Data & AI" },
  { name: "ML Engineer", category: "Data & AI" },
  { name: "AI/ML Researcher", category: "Data & AI" },
  { name: "Business Intelligence Analyst", category: "Data & AI" },

  // Infra & Ops
  { name: "DevOps Engineer", category: "Infra & Ops" },
  { name: "Site Reliability Engineer (SRE)", category: "Infra & Ops" },
  { name: "Cloud Engineer", category: "Infra & Ops" },
  { name: "Cybersecurity Engineer", category: "Infra & Ops" },
  { name: "QA / Test Engineer", category: "Infra & Ops" },
  { name: "Network Engineer", category: "Infra & Ops" },

  // Hardware & ECE
  { name: "Embedded Systems Engineer", category: "Hardware & ECE" },
  { name: "Firmware Engineer", category: "Hardware & ECE" },
  { name: "VLSI Engineer", category: "Hardware & ECE" },
  { name: "Hardware Design Engineer", category: "Hardware & ECE" },
  { name: "RF Engineer", category: "Hardware & ECE" },
  { name: "IoT Engineer", category: "Hardware & ECE" },

  // Product & Design
  { name: "Product Manager", category: "Product & Design" },
  { name: "Product Engineer", category: "Product & Design" },
  { name: "UI/UX Designer", category: "Product & Design" },
  { name: "Business Analyst", category: "Product & Design" },

  // Business & Non-tech
  { name: "Sales", category: "Business & Non-tech" },
  { name: "Business Development / GTM", category: "Business & Non-tech" },
  { name: "Marketing", category: "Business & Non-tech" },
  { name: "Digital Marketing", category: "Business & Non-tech" },
  { name: "Content Strategist", category: "Business & Non-tech" },
  { name: "HR / People Ops", category: "Business & Non-tech" },
  { name: "Finance / Accounting", category: "Business & Non-tech" },
  { name: "Operations", category: "Business & Non-tech" },
  { name: "Customer Success", category: "Business & Non-tech" },
  { name: "Legal & Compliance", category: "Business & Non-tech" },
  { name: "Consulting", category: "Business & Non-tech" },
  { name: "Supply Chain / Logistics", category: "Business & Non-tech" },
];
