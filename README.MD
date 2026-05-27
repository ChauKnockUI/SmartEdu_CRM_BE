npx prisma generate
npx prisma studio --port 5556

#cài thư viện supabase bucket
npm install @supabase/supabase-js

npm install multer
npm i -D @types/multer

## Dropout Early Warning

Flow:

```text
Attendance / Assignment / Invoice / TestResult
-> Backend aggregates dropout features per student and class
-> AI service POST /predict-dropout
-> Backend updates students.dropout_risk, dropout_risk_level, dropout_risk_reasons
-> Backend appends ai_predictions with prediction_type = dropout_risk
```

Required AI env:

```env
AI_DROPOUT_RISK_URL=http://127.0.0.1:8000/predict-dropout
```

Manual scoring endpoint:

```http
POST /students/:id/dropout-risk/score?class_id=123
```
