# 프로그램 개발 간 절대 원칙

> 개발 간 식별된 오류는 수정 후 절대 반복되지 않음
> 오류의 식별을 위해 프로그램 로그는 error.log에 남겨둘 것
> 개발은 반드시 Github과 같이 간다.
> README.md를 작성하여 commit&push하며, 주요 내용이 변경될 때마다 README도 항상 함께 수정한다.
> .gitignore도 적용하여 commit할 것
> Github repo는 아래에 있음

## github
echo "# HydroNet" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/hjlee624/HydroNet.git
git push -u origin main


git remote add origin https://github.com/hjlee624/HydroNet.git
git branch -M main
git push -u origin main
