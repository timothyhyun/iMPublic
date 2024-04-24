import { ChangeDetectionStrategy, Component, HostListener, OnInit, DoCheck } from '@angular/core';
import { Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ChangeMakerFacade, PoiCmStoreModel } from '@involvemint/client/cm/data-access';
import { ImImagesViewerModalService } from '@involvemint/client/shared/data-access';
import { RouteService } from '@involvemint/client/shared/routes';
import {
  ConfirmComponentDeactivation,
  getPosition,
  LatLng,
  parseOneImageFile,
  StatefulComponent,
  StatusService,
} from '@involvemint/client/shared/util';
import {
  calcTotalPoiDuration,
  calculateCreditsEarnedForPoi,
  calculatePoiDurationFromNow,
  calculatePoiMandatoryClockOutDate,
  calculatePoiStatus,
  ImConfig,
  PoiStatus,
  QuestionAnswersDto,
} from '@involvemint/shared/domain';
import { formatDistanceHMS, getDateDistanceDigits, parseDate, tapOnce } from '@involvemint/shared/util';
import { FormArray, FormControl } from '@ngneat/reactive-forms';
import { addSeconds, compareAsc, isBefore, isEqual } from 'date-fns';
import { EMPTY, timer } from 'rxjs';
import { filter, switchMap, tap } from 'rxjs/operators';

interface State {
  poi: PoiCmStoreModel | null;
  loaded: boolean;
  status: PoiStatus | null;
  files: File[];
  imgLocalUrls: string[];
  timeElapsedHour: number;
  timeElapsedMinute: number;
  timeElapsedSecond: number;
  mandatoryClockOutDate: Date | null;
  mandatoryClockOutDateFromNow: string;
}

@Component({
  selector: 'involvemint-poi',
  templateUrl: './poi.component.html',
  styleUrls: ['./poi.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoiComponent extends StatefulComponent<State> implements OnInit, ConfirmComponentDeactivation {
  readonly questions = new FormArray<string>([]);

  readonly maxImagesPerItem = new Array(ImConfig.maxImagesPerItem);

  get PoiStatus() {
    return PoiStatus;
  }

  constructor(
    private readonly cf: ChangeMakerFacade,
    private readonly route: RouteService,
    private readonly activatedRoute: ActivatedRoute,
    private readonly status: StatusService,
    private readonly imgViewer: ImImagesViewerModalService
  ) {
    super({
      poi: null,
      loaded: false,
      status: null,
      files: [],
      imgLocalUrls: [],
      timeElapsedHour: 0,
      timeElapsedMinute: 0,
      timeElapsedSecond: 0,
      mandatoryClockOutDate: null,
      mandatoryClockOutDateFromNow: '',
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  canDeactivate() {
    return this.questions.pristine;
  }

  ngOnInit(): void {
    const id = this.activatedRoute.snapshot.paramMap.get('id');
    if (!id) {
      this.back();
      return;
    }
    this.effect(() =>
      this.cf.poi.selectors.getPoi(id).pipe(
        tap(({ poi, loaded }) => {
          this.updateState({
            poi,
            loaded,
            status: poi ? calculatePoiStatus(poi) : null,
          });
          if (this.state.status && this.state.status >= PoiStatus.submitted) {
            this.questions.markAsPristine();
          }
        }),
        filter(({ poi }) => !!poi),
        tapOnce(({ poi }) => {
          console.log("creating questions")
          poi?.enrollment.project.questions.forEach((_, i) => {
            this.questions.insert(
              i,
              new FormControl(poi?.answers[i]?.answer || '', (e) => Validators.required(e))
            );
          });
        }),
        tap(() => {
          this.loadfromLocalStorage()

        }),
        switchMap(({ poi }) => {
          if (!poi || !poi.dateStarted) {
            return EMPTY;
          }

          if (this.state.status && this.state.status >= PoiStatus.stopped) {
            const now = new Date();
            const { hours, minutes, seconds } = getDateDistanceDigits(
              now,
              addSeconds(now, calcTotalPoiDuration(poi))
            );
            this.updateState({
              timeElapsedHour: hours,
              timeElapsedMinute: minutes,
              timeElapsedSecond: seconds,
            });
            return EMPTY;
          }

          if (this.state.status === PoiStatus.paused) {
            const now = new Date();
            const { hours, minutes, seconds } = getDateDistanceDigits(
              now,
              addSeconds(now, calculatePoiDurationFromNow(poi))
            );
            this.updateState({
              timeElapsedHour: hours,
              timeElapsedMinute: minutes,
              timeElapsedSecond: seconds,
            });
            return EMPTY;
          }

          return timer(0, 999).pipe(
            tap(() => {
              const now = new Date();

              const mCoD = calculatePoiMandatoryClockOutDate(poi);
              if (isBefore(mCoD, now) || isEqual(mCoD, now)) {
                location.reload();
              }

              const { hours, minutes, seconds } = getDateDistanceDigits(
                now,
                addSeconds(now, calculatePoiDurationFromNow(poi))
              );

              this.updateState({
                timeElapsedHour: hours,
                timeElapsedMinute: minutes,
                timeElapsedSecond: seconds,
                mandatoryClockOutDate: mCoD,
                mandatoryClockOutDateFromNow: formatDistanceHMS(mCoD, now),
              });
            })
          );
        })
      )
    );

    this.effect(() => 
        timer(15000,10000).pipe(
          tap(() => {
            this.saveToLocalStorage()
          })
        )
    );
  }


  saveToLocalStorage() {
    console.log("saving")
    localStorage.setItem('poiFormData', JSON.stringify(this.questions.value));
  }

  saveImagesToLocalStorage() {
    console.log("saving images")
    localStorage.setItem('poiImageData', JSON.stringify(this.state.imgLocalUrls))
  }

  clearLocalStorage() {
    console.log("clearing")
    localStorage.removeItem('poiFormData');
    localStorage.removeItem('poiImageData');
  }

  loadfromLocalStorage() {
    console.log("loading")
    const form = localStorage.getItem('poiFormData')
    const formData = JSON.parse(form || '{}');
    console.log(formData.length)
    console.log(form)
    if (form) {
      console.log("got question here")
      console.log(this.questions.value.length)
      this.questions.setValue(formData);
    }
    const imageForm = localStorage.getItem('poiImageData')
    const imageData = JSON.parse(imageForm || '{}');
    console.log(imageData)
    const fileList = []
    if (imageForm) {
      for (let i = 0; i < imageData.length; i++) {
        var base64Parts = imageData[i].split(",");
        var fileFormat = base64Parts[0].split(";")[1];
        var fileContent = base64Parts[1];
        var file = new File([fileContent], "upload".concat(String(i)), {type: fileFormat});
        fileList.push(file)
        console.log(fileList)
      }
      this.updateState({
        files: fileList,
        imgLocalUrls: imageData,
      });
    }
  }

  back() {
    this.clearLocalStorage();
    return this.route.back(() => this.route.to.cm.pois.ROOT({ animation: 'back' }));
  }

  refresh() {
    this.cf.poi.dispatchers.refresh();
  }

  uploadImage(event: Event): void {
    let file: File | undefined;
    try {
      file = parseOneImageFile(event);
      console.log(file);
    } catch (error) {
      this.status.presentAlert({ title: 'Error', description: error.message });
    }

    console.log(file);

    if (!file) return;

    this.updateState({ files: [...this.state.files, file] });
    this.updateFileUrls();
  }

  updateFileUrls() {
    for (let i = 0; i < this.state.files.length; i++) {
      const file = this.state.files[i];

      const reader = new FileReader();
      reader.readAsDataURL(file);

      reader.onload = () => {
        const imgUrls = this.state.imgLocalUrls;
        imgUrls[i] = reader.result as string;
        this.updateState({ imgLocalUrls: imgUrls });
        this.saveImagesToLocalStorage();
      };
    }
  }

  deleteImage(index: number) {
    this.updateState({
      files: this.state.files.filter((_, i) => i !== index),
      imgLocalUrls: this.state.imgLocalUrls.filter((_, i) => i !== index),
    });
  }

  async startTimer(poi: PoiCmStoreModel) {
    let latLng: LatLng | undefined;
    try {
      latLng = await getPosition(this.status);
    } catch (error) {
      console.error(error);
    }
    this.cf.poi.dispatchers.start(poi, latLng);
  }

  withdraw(poi: PoiCmStoreModel) {
    this.cf.poi.dispatchers.withdraw(poi);
  }

  pauseTimer(poi: PoiCmStoreModel) {
    this.cf.poi.dispatchers.pause(poi);
  }

  resumeTimer(poi: PoiCmStoreModel) {
    this.cf.poi.dispatchers.resume(poi);
  }

  submit(poi: PoiCmStoreModel) {
    this.clearLocalStorage();
    this.cf.poi.dispatchers.submit(
      poi,
      this.state.files,
      poi.enrollment.project.questions.map(
        (question, i): QuestionAnswersDto => ({
          answer: this.questions.value[i],
          questionId: question.id,
        })
      )
    );
  }

  stop(poi: PoiCmStoreModel) {
    this.cf.poi.dispatchers.stop(poi);
  }

  viewImages(urls: string[], index: number) {
    this.imgViewer.open({
      imagesFilePaths: urls,
      slideIndex: index,
    });
  }

  getPausedResumedTimes(poi: PoiCmStoreModel) {
    return [
      ...poi.pausedTimes.map((t) => ({ date: t, type: 'paused' })),
      ...poi.resumedTimes.map((t) => ({ date: t, type: 'resumed' })),
    ].sort((a, b) => compareAsc(parseDate(a.date), parseDate(b.date)));
  }

  calculateCreditsEarnedForPoi(poi: PoiCmStoreModel) {
    return calculateCreditsEarnedForPoi(poi);
  }
}
