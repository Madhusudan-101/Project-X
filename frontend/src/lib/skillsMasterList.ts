// Proposed seed list for public.skills — pending approval.
// Categories are informational (grouping in the picker UI), not enforced.
export interface MasterSkill {
  name: string;
  category: string;
}

export const SKILLS_MASTER_LIST: MasterSkill[] = [
  // Programming Languages
  { name: "JavaScript", category: "Programming Languages" },
  { name: "TypeScript", category: "Programming Languages" },
  { name: "Python", category: "Programming Languages" },
  { name: "Java", category: "Programming Languages" },
  { name: "C++", category: "Programming Languages" },
  { name: "C", category: "Programming Languages" },
  { name: "C#", category: "Programming Languages" },
  { name: "Go", category: "Programming Languages" },
  { name: "Rust", category: "Programming Languages" },
  { name: "Kotlin", category: "Programming Languages" },
  { name: "Swift", category: "Programming Languages" },
  { name: "Ruby", category: "Programming Languages" },
  { name: "PHP", category: "Programming Languages" },
  { name: "R", category: "Programming Languages" },
  { name: "SQL", category: "Programming Languages" },

  // Frontend
  { name: "React", category: "Frontend" },
  { name: "Angular", category: "Frontend" },
  { name: "Vue.js", category: "Frontend" },
  { name: "Next.js", category: "Frontend" },
  { name: "HTML/CSS", category: "Frontend" },
  { name: "Tailwind CSS", category: "Frontend" },
  { name: "Redux", category: "Frontend" },

  // Backend / Frameworks
  { name: "Node.js", category: "Backend" },
  { name: "Express.js", category: "Backend" },
  { name: "Django", category: "Backend" },
  { name: "Flask", category: "Backend" },
  { name: "FastAPI", category: "Backend" },
  { name: "Spring Boot", category: "Backend" },
  { name: ".NET", category: "Backend" },
  { name: "Ruby on Rails", category: "Backend" },

  // Databases
  { name: "MySQL", category: "Databases" },
  { name: "PostgreSQL", category: "Databases" },
  { name: "MongoDB", category: "Databases" },
  { name: "Redis", category: "Databases" },
  { name: "Firebase", category: "Databases" },
  { name: "SQLite", category: "Databases" },

  // Cloud & DevOps
  { name: "AWS", category: "Cloud & DevOps" },
  { name: "Microsoft Azure", category: "Cloud & DevOps" },
  { name: "Google Cloud Platform", category: "Cloud & DevOps" },
  { name: "Docker", category: "Cloud & DevOps" },
  { name: "Kubernetes", category: "Cloud & DevOps" },
  { name: "CI/CD", category: "Cloud & DevOps" },
  { name: "Git", category: "Cloud & DevOps" },
  { name: "Linux", category: "Cloud & DevOps" },
  { name: "Terraform", category: "Cloud & DevOps" },

  // Data & ML
  { name: "Machine Learning", category: "Data & ML" },
  { name: "Deep Learning", category: "Data & ML" },
  { name: "Data Analysis", category: "Data & ML" },
  { name: "Pandas", category: "Data & ML" },
  { name: "NumPy", category: "Data & ML" },
  { name: "TensorFlow", category: "Data & ML" },
  { name: "PyTorch", category: "Data & ML" },
  { name: "Data Visualization", category: "Data & ML" },
  { name: "Power BI", category: "Data & ML" },
  { name: "Tableau", category: "Data & ML" },
  { name: "NLP", category: "Data & ML" },
  { name: "Computer Vision", category: "Data & ML" },

  // Mobile
  { name: "Android Development", category: "Mobile" },
  { name: "iOS Development", category: "Mobile" },
  { name: "React Native", category: "Mobile" },
  { name: "Flutter", category: "Mobile" },

  // Testing / QA
  { name: "Manual Testing", category: "Testing & QA" },
  { name: "Automation Testing", category: "Testing & QA" },
  { name: "Selenium", category: "Testing & QA" },
  { name: "Postman", category: "Testing & QA" },

  // Design
  { name: "UI/UX Design", category: "Design" },
  { name: "Figma", category: "Design" },
  { name: "Adobe Photoshop", category: "Design" },
  { name: "Graphic Design", category: "Design" },

  // Product & Business
  { name: "Product Management", category: "Product & Business" },
  { name: "Business Analysis", category: "Product & Business" },
  { name: "Project Management", category: "Product & Business" },
  { name: "Agile/Scrum", category: "Product & Business" },

  // Marketing & Sales
  { name: "Digital Marketing", category: "Marketing & Sales" },
  { name: "SEO", category: "Marketing & Sales" },
  { name: "Content Writing", category: "Marketing & Sales" },
  { name: "Social Media Marketing", category: "Marketing & Sales" },
  { name: "Sales", category: "Marketing & Sales" },
  { name: "Market Research", category: "Marketing & Sales" },

  // Finance & Ops
  { name: "Financial Analysis", category: "Finance & Ops" },
  { name: "Accounting", category: "Finance & Ops" },
  { name: "Excel", category: "Finance & Ops" },
  { name: "Operations Management", category: "Finance & Ops" },

  // Soft skills / Other
  { name: "Communication", category: "Soft Skills" },
  { name: "Leadership", category: "Soft Skills" },
  { name: "Public Speaking", category: "Soft Skills" },
  { name: "Problem Solving", category: "Soft Skills" },
  { name: "Teamwork", category: "Soft Skills" },
];
